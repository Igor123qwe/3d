# Лидеры профессионального 2D-черчения: Floorplanner и RoomSketcher

Дата: 2026-09-26. Метод: WebSearch (англ. + рус.) по help-центрам, release notes, отзывам (Capterra, Trustpilot, G2, App Store, Google Play), плюс **официальный Floorplanner Editor Manual (ноябрь 2022, 60 стр.)** и две брошюры «Floorplanner tricks» — их PDF лежат на `fpcdn.s3.amazonaws.com`, который прокси пропускает; текст вынут `pypdfium2` в `audit/fp-src/*.txt`. Сайты `help.floorplanner.com`, `help.roomsketcher.com`, `roomsketcher.com`, Trustpilot, Capterra, App Store, Google Play через WebFetch закрыты (EGRESS_BLOCKED), поэтому их цитаты — из поисковых сниппетов.

Метки: **[проверено: источник]** — факт виден в тексте мануала/PDF или в сниппете названной страницы; **[сниппет: …]** — виден в сниппете, но исходная страница могла быть урезана или сниппет смешан с соседним результатом; **[по памяти]** — знание без свежего подтверждения; **[не найдено]** — искал, не нашёл; **[противоречие]** — источники расходятся.

Наш продукт для сравнения: `/home/user/3d` (README.md строки 81–92 — правка стен; `src/planner/walledit.ts`, `dims.ts`, `PlannerCanvas.tsx`, `PlannerPage.tsx`, `types.ts`, `exporters.ts`).

---

## 0. Резюме

1. **Оба лидера задают длину стены через число + «в какую сторону расти».** Floorplanner: щёлкнуть по автоматическому размеру комнаты → набрать число → нажать одну из стрелок, чтобы сказать, какая стена сдвинется [проверено: Manual 2022, стр. 26 и 46]. RoomSketcher: щёлкнуть по концу стены, появляются стрелки, ввести длину внутри/снаружи в поле справа — «the length will increase or decrease on the side with the arrows» [проверено: help.roomsketcher.com/…/360000202509]. У нас длина вводится в панели свойств одним числом (`PlannerPage.tsx:2142`), а «какой конец едет» не выбирается — это самый очевидный пробел.
2. **Floorplanner — единственный, где число вводится прямо во время перетаскивания:** при вытягивании ниши синяя стрелка показывает расстояние до противоположной стены, «while you are dragging, you can type in the size this distance should have, and confirm by ENTER» [проверено: Manual, стр. 28]. У нас во время перетаскивания видно «сдвиг N см» (README:81), но набрать число нельзя.
3. **Ниша/выступ у Floorplanner — «разбей дважды и тяни средний кусок»** (Manual, стр. 28), та же парадигма, что у Planner 5D; у нас — Alt + тянуть участок (README:82, `PlannerCanvas.tsx:722-725`). Это наше реальное преимущество, и его надо показывать в онбординге.
4. **Множественный выбор: Floorplanner — да (Shift + рамка, Shift + клик, фильтр «только стены/только мебель», группы, копипаст между этажами), RoomSketcher — нет вовсе** («Currently, you can not multi-select individual items to create your own grouped sets» [сниппет: help.roomsketcher.com/…/14546892866205]). У нас `Selection` — один объект (`types.ts:212-217`).
5. **Стены у обоих — сегменты между узлами, и топология хрупкая.** Floorplanner в собственной брошюре признаёт: перекрывающиеся стены ломают распознавание комнат, «corners too close to each other» дают «buggy floorplans where your rooms won't show» [проверено: FPTricks_RepairingYourFloorplan.pdf]. RoomSketcher: «when a wall is connected at a non-90-degree angle, you won't be able to adjust its length» [сниппет: help.roomsketcher.com]. У нас `normalizeWalls` склеивает куски после правки (`walledit.ts:367`), и прямая правится целиком (`wallRun`, `walledit.ts:46`).
6. **Размеры «в чистоте» есть у обоих, но по-разному:** Floorplanner автоматически рисует и внутренние, и наружные размеры вокруг стен и даёт их прятать (Manual, стр. 46, 49); RoomSketcher различает inside/outside length у каждой стены и имеет «мастеров размеров» (Room / Wall / Room Dimensions / Outside) — но только в Pro [проверено: help …/115005898829]. У нас — размер каждой стороны комнаты по внутренней грани (README:14) и выбор «по оси / внутри / снаружи» (`PlannerPage.tsx:198-200`).
7. **Распознавание плана с картинки:** RoomSketcher AI Convert — ~5 с, выпрямляет перекос, но «even if your blueprint shows measurements, these aren't detected automatically» — масштаб задаётся одной известной длиной руками [проверено: help …/35537884534429]. Floorplanner своей автоматики не имеет: картинка — фон для обводки; конвертация — через партнёра Vloor за кредиты [проверено: Manual, стр. 25; floorplanner.readme.io/reference/vloor]. Наш `planai.ts` читает подписи и сверяет площади — этого нет ни у кого из двоих.
8. **За что ругают:** Floorplanner — «adjust measurements in 'cm' and say which way to expand» (сложно), «walls connected but in different directions — would not let me move one side… had to start all over», DXF-экспорт «shapes broken apart into individual lines… furniture not exported», Trustpilot 2.4/5 (16 отзывов). RoomSketcher — кредиты («5 of their credits were wasted because they didn't understand how the system works»), «no longer supported on phones», Google Play (планшеты) 2.62/5 при Capterra 4.3 (1 084 отзыва).
9. **Чего у нас нет, а у них есть и это важно для «профессионального» черчения:** PDF в масштабе с выбором формата листа (оба), DXF (Floorplanner), мастер размеров «все комнаты одним щелчком» и «габарит всего плана» (RoomSketcher), выбор конца при вводе длины (оба), число во время перетаскивания (Floorplanner), множественный выбор (Floorplanner), нулевая стена/делитель для зон (оба), «сдвиг стены поперёк оси» степпером для выравнивания граней (Floorplanner), история версий (Floorplanner «Restore older version»).

---

## 1. Кто есть кто

- **Floorplanner** (Роттердам, с 2007, «almost 3 million registered users») [сниппет: machow2.com/floorplanner-review]. Каталог «150 000+ 3D models» на странице Basic [сниппет: floorplanner.com/basic]; в русском обзоре — «260 000+» [сниппет: klerk.ru] [противоречие]. Бренды: Roomstyler (потребительский), Enterprise с API и white-label [сниппет: floorplanner.com/enterprise], интеграция с magicplan [сниппет: help.magicplan.app/floorplanner-integration]. Оценки: Capterra 4.2/5 (25 отзывов), Trustpilot 2.4/5 (16), G2 4.5/5 (2) [сниппеты соответствующих страниц].
- **RoomSketcher** (Норвегия [по памяти]; «более 6 миллионов пользователей» [сниппет: apps.apple.com/ru]). Приложение для Windows/Mac/iPad/Android-планшетов + веб-портал; FloorCapture (LiDAR, beta); AI Convert («2.5 years of development… over 50,000 floor plans manually annotated» [сниппет: roomsketcher.com/news/roomsketcher-launches-ai-convert]); сервис перерисовки планов людьми ($38/этаж). Оценки: Capterra 4.3/5 (1 084), Trustpilot 4.4/5 (348; 10 % — одна звезда; «replied to 100% of negative reviews»), G2 4.5/5 (30), Google Play «RoomSketcher for Tablets» 2.62/5 (270) [сниппеты].

---

## 2. Floorplanner

### 2.1 Рисование стен

**Три инструмента в Build: Draw Rooms, Draw Walls, Draw Surfaces** [проверено: Manual, стр. 4, 26–27, 34].

- **Draw Room (быстрый путь):** «click the draw room icon and setup your wall thickness and height in the sidebar or by typing», затем «click in your canvas and drag your mouse towards the direction and size you want your room to be», на отпускании «you'll get automatic dimensions showing the interior room dimensions and exterior dimensions» [проверено: Manual, стр. 26]. Комнаты «are always attached to each other, and after drawing the first room, every room is drawn from an existing corner point» [сниппет: Manual 2013 через поиск].
- **Draw Wall (любая форма):** «click in the canvas and drag your mouse in the direction you want your wall. Release where you want your wall to end **or type in your desired length and press Enter**» [проверено: Manual, стр. 27]. Подсказки: «the blue circle indicates your wall thickness»; «guidelines will help you find the end of a room or vertical or horizontal direction»; «Close the room by starting on the starting point. A room surface will appear»; «Keep in mind that wall thickness affects the wall length when going around a corner» [проверено: стр. 27]. Толщина до рисования задаётся набором числа: «Type the right wall thickness followed by Enter» [проверено: FPTricks_DrawingAngledPlans.pdf, стр. 2].
- **Комната = замкнутый контур:** «A space enclosed by walls becomes a room, and is given a floor and ceiling surface automatically» [проверено: стр. 27]. Удаление сегмента: «If the space is not enclosed anymore… the floor will disappear. If two rooms are connected this way, the two separate floors merge into one» [проверено: стр. 29].
- **Ортогональность и углы:** жёсткого орто-режима или привязки к 15°/45° в мануале нет — только направляющие (guidelines/snap-lines) «to find perpendiculars» [проверено: стр. 27, 45]. Угол стены меняется перетаскиванием угла: «Move your mouse over a wall corner, click and drag it to change the wall angle» [проверено: стр. 28]. Для наклонных планов брошюра советует «rotate [background] so most of the walls are either horizontal or vertical» и строить угловую стену через «split → draw rooms → delete redundant walls» [проверено: FPTricks_DrawingAngledPlans.pdf]. (Сниппет про «Shift — free angles, Ctrl — 15°» относится к стороннему PyQt-проекту на GitHub с тем же названием, **не** к floorplanner.com — не учитываю.)
- **Привязка:** «When drawing or dragging items you will often snap to other items in your canvas. Hold **S** to temporarily disable snap» [проверено: стр. 10; подтверждено постом @floorplanner на X]. Настройки привязки/сетки как таковых нет — сетка это только вид «Black and white» [проверено: стр. 11].
- **Стена из точки на существующей стене:** выделить стену → третья иконка → «Move your mouse to where you want your wall to end and click again» [проверено: стр. 29] — аналог нашего Т-стыка.
- **Хрупкость топологии (собственная брошюра):** «If walls overlap each other, our room detection won't work»; «If wall corners are too close to each other, this can result in buggy floorplans where your rooms won't show»; «It can happen that you think your dots are connected but in fact they aren't»; рекомендация — «draw your exterior walls first, then add your rooms one by one» [проверено: FPTricks_RepairingYourFloorplan.pdf, стр. 2–7]. Т.е. пользователь сам отвечает за то, чтобы узлы совпали.

**Горячие клавиши (Manual, стр. 59, реконструкция из PDF-разметки, часть привязок «клавиша ↔ функция» восстановлена по порядку в таблице):** `w` стена, `r` комната, `f` поверхность, `t` текст, `d` размерная линия, `l` линия, `m` рулетка, `b` скрыть/показать подложку, `Shift` + рамка — выбор, `Cmd/Ctrl+A` выбрать всё, `Cmd+C/V` копировать/вставить в другой этаж/дизайн, `g` группы, `s` (удерживать) — без привязки, `Esc` выйти из режима, `Del/Backspace`, `Space` — панорама, `r/l` поворот 5°, `R/L` 15°, стрелки — сдвиг (с Shift «in steps of 10 cm/4 inch»), `< >` — переключение этажей, `?` — список шортката в сайдбаре [проверено: стр. 59, с оговоркой о реконструкции].

### 2.2 Правка стен и комнат (особое внимание)

**Что происходит при щелчке по стене:** стена выделяется, в сайдбаре — «info and options to customize each side, also the thickness, height and raise of the segment»; «Icons for the most important modifications can be found around the object» (split, curve, draw-from-point, remove); «Here you can quickly find some objects to place on your walls». **Двойной щелчок ведёт сразу в настройки:** «double-clicking on an object will bring you directly in this settings menu so you can go right away and change the dimensions» [проверено: Manual, стр. 7]. У выделенной стены есть **Front view** — фасад стены с материалами двух сторон и расстановкой навесных предметов [проверено: стр. 33].

**Как задаётся длина после рисования:** через автоматический размер. «You can change the room size by clicking on a dimension line and typing the size you need. Use one of the arrow buttons to indicate which wall to move» [проверено: стр. 46]; то же на стр. 26: «You can click the inner dimensions to set the exact room size. Click the arrows to indicate which wall should move». Статья help-центра «How to enter the exact measurements of a wall?» существует (id 8437038), её текст в сниппете смешан с Houzz Pro — не цитирую. Для «структур» (колонны, балки) — «use the + and - buttons on the sides of each entry field, or type in the desired measurement» [сниппет: help …/8441241].

**Что при перетаскивании стены с другими стенами:** мануал описывает перетаскивание сегмента после сплита (ниша) и перетаскивание угла (меняет угол соседних стен) [проверено: стр. 28]; явного правила «стена двигается только поперёк, примыкающие тянутся» нет. Отзывы говорят, что связность иногда мешает: «if I had walls connected but were in different directions it would not let me move one side for some reason. In some cases I had to start all over» [сниппет: Capterra]; «wall parts have a problem with becoming dislodged or deciding that straight walls have a curve when they do not» [сниппет: Capterra].

**Ниша / выступ (alcove):** «1) Click on a wall segment, and press this icon to split the wall. 2) Click a bit further on a wall segment, and press this icon to split the wall again. 3) Now you can click and drag the new wall segment in the middle. Release your mouse to form your alcove. Tip: the blue arrow indicates the distance to the opposite wall. While you are dragging, you can type in the size this distance should have, and confirm by ENTER» [проверено: стр. 28]. Это ровно та операция, которую у нас делает Alt + тянуть (README:82) без двух сплитов.

**Сдвиг стены поперёк оси (выравнивание граней разной толщины):** «When working with different wall thicknesses, you may encounter situations when the wall inside a room jumps due to this thickness difference. To solve this, we've introduced an option to move the wall perpendicular to the axis» — двойной щелчок по толстой стене → степпер «move wall across axis» → Esc [проверено: стр. 30]. Приём напрямую относится к нашей теме «длина по грани vs по оси».

**Кривая стена:** иконка curve на выделенной стене, «to uncurve the wall, click the curve icon again… the wall will snap to a straight line» [проверено: стр. 28]. **Наклонные стены** — через высоту узлов: «Select the joint you just made, and set the desired height in the sidebar… you can set the height for all wall segments connecting to this joint together or each individually» [проверено: стр. 31]. **Невидимая стена** — толщина 0: делит комнату на зоны, «will show neither in 2D nor in 3D, but it is still selectable in 2D», Magic Layout считает её открытой стороной [проверено: стр. 32].

**Удаление куска:** четвёртая иконка на сегменте — «Removing a wall segment» [проверено: стр. 29]. Удалить часть стены без сплита нельзя [не найдено].

**Множественный выбор:** «hold Shift and drag a rectangular area… or click multiple objects one by one while holding Shift»; «in the sidebar you can limit your selection to only walls or only furniture»; операции — «move, remove, duplicate, rotate, mirror or edit elseways collectively»; «press Cmd+C… open a new floor/design and press Cmd+V» [проверено: стр. 12–13]. Отдельно рекламируют «Copy and paste multiple walls: press shift to select multiple walls… copy & paste, delete, mirror and rotate» [сниппет: facebook.com/floorplanner видео]. При перетаскивании выделения «use the snapping guidelines to connect the walls properly and avoid errors» [проверено: стр. 13].

**Замок:** кнопка в шапке «Lock/unlock items: Lock structurals, information or furniture» — замок по категориям, не на конкретную стену [проверено: стр. 10]. У нас — на одну стену и на все (`walledit.ts:494, 502`).

**Единицы при вводе — боль:** «the design measurements despite being clearly in meters, when modifying you have to convert to cm»; «a overly complex UI where you have to adjust measurements in 'cm' and say which way to expand» [сниппет: Capterra]; «a bit difficult to set-up room dimensions — needed to do them manually» [сниппет: Capterra]. Т.е. сам паттерн «число + направление» пользователи считают правильным, но нагрузка от переключения единиц и обязательного выбора стрелки раздражает — вывод для нас: направление должно иметь разумный дефолт.

### 2.3 Размеры и единицы

- Единицы — «Set units to Meter or Feet» в нижнем левом углу [проверено: стр. 10, 24]; сантиметров как отдельного режима нет (см. жалобу выше).
- **Автоматические размеры:** «Floorplanner generates automatic dimensions around your walls… Inner wall dimensions, Exterior wall dimensions» [проверено: стр. 46]. Это ближе всего к нашему «размер в чистоте у каждой стороны комнаты» (README:14), плюс наружный габарит, которого у нас нет.
- **Настройки размеров (2D View Settings → Dimensions):** показать, какие размеры автоматические; подписи горизонтально или вдоль линии; стрелки; размеры рядом со стенами; «Hide the exterior dimensions»; «Label scale»; «Hide all dimensions at once for a clean looking plan» [проверено: стр. 49]; «Show short dimension lines» — отдельный переключатель [сниппет: help …/8438764].
- **Из автоматических в ручные:** «press [кнопку] to convert them all to separate dimension lines», после чего их можно удалять и «merge» (удалить одну, изменить другую) [проверено: стр. 46–47].
- **Ручная размерная линия:** `d`, «click, drag and release»; «type in the length you want your line to be while you are dragging your mouse, and hit Enter»; правка: «Click on the dimension line… Select the dimension value to edit… Type in the size… Then click on one of the arrows buttons to move one of the arrowhead to its new position»; ручную от автоматической отличают «blue dots on either side and the presence of a trashbin» [проверено: стр. 47–48]. Заметьте: и здесь «число + стрелка = какой конец переехал».
- Рулетка `m` — «Tape measure: to measure a distance» [проверено: стр. 10].
- Точность перетаскивания заявлена «with a precision of 1 cm, or a quarter of an inch» [сниппет: floorplanner.com/personal].

### 2.4 Двери, окна, проёмы

- Библиотека дверей/окон с 2D/3D-превью; «drag and drop your door or window onto a wall»; «Doors auto-snap into walls» и «can only be placed over an existing wall» [проверено: стр. 39; сниппет: help …/8439089]. После щелчка: «adjust the wall side, hinge side and an option to duplicate and remove»; в сайдбаре — «width, height and raise from the floor»; цвет рамы/полотна/порога «apply that to all doors»; «You can even open the door which will show in your 3D view» [проверено: стр. 39]. Направление открывания — «Click on the quarter-circles to adjust the swing» [сниппет: help-центр через поиск].
- Проём без двери как отдельный тип — в мануале не описан [не найдено; по памяти — есть «opening» в библиотеке].

### 2.5 Каталог мебели и техники

- Поиск, категории/подкатегории, фильтр по бренду и цвету, избранное (в каждом проекте), «Similar items» с кнопкой swap, фильтр «Only items that can be resized (most branded items have a fixed size)» [проверено: стр. 50–51]. Масштабирование объекта — ручками или в настройках (высота, отметка от пола, свой ярлык) [проверено: стр. 51].
- Жалобы: «Users can't customize the size/measurements of tables/chairs, and nothing is to scale»; «you cannot rotate it on vertical axis, only horizontally» [сниппеты: Capterra/GetApp].

### 2.6 Отделка

- Paint: наборы цветов производителей красок, hex-код, подбор сочетаний, избранное (Plus/Pro), drop на комнату/стену/поверхность; для стены — «hold it over a wall segment. Then drop it on either of the circles appearing next to it» (сторона стены) [проверено: стр. 52, 54]. Materials: wood, carpet, stone, tiles, wallpaper, outdoor, поставщики [стр. 54]. Штриховки (hatch) для 2D с поворотом/масштабом/прозрачностью [стр. 53]. Цвет/текстура потолка и его отключение [сниппет: facebook.com/floorplanner]. Своя картинка на стене (tile/stretch) [стр. 33].

### 2.7 ИИ-функции

- **Magic Layout:** «1) Apply a room type to your room 2) Select a roomstyle 3) Press Magic Layout to have floorplanner suggest a layout for this room in the selected style 4) …switch styles and choose restyle to have the layout stay, but the furniture and materials swapped» [проверено: стр. 55]; «click Magic Layout again (and as many times as desired) to rearrange the items» [сниппет: help …/8448959]; работает и для наружных пространств [сниппет: x.com/floorplanner 2021]. Доступен в бесплатном Basic [сниппет: floorplanner.com/basic]. Проверок геометрии/эргономики после раскладки нет [не найдено]; конкурент пишет «results often required manual adjustments» [сниппет: roomsketcher.com/blog — источник заинтересованный].
- **AI image enhancement + AI tokens (2025):** перекраска/ре-стайл любого экспорта, «20 AI tokens per image (5 images = 1 credit)… convert 1 credit → 100 AI tokens… tokens don't expire but can't be converted back» [сниппет: updates.floorplanner.com]. Это image-to-image, не планировка.
- **План с картинки:** автоматики нет — «Floorplanner does not auto-detect walls from an uploaded image… tracing-based» [сниппет: coohom.com/article — конкурент, но совпадает с мануалом]. Порядок: Build → upload PNG/JPG/PDF → Edit → Settings: повернуть, landscape/portrait → «Click Scale background… Zoom in to something in your plan of which you know the distance. Click on both sides of this element to draw a line and enter the distance and press OK. To get more accuracy, you can repeat this step once more» → обводить, «Make sure to set your wall thickness to match the walls in the background image», `B` прячет фон [проверено: стр. 24–25]. Партнёр **Vloor**: «have your floorplan image converted in a Floorplan for 2 credits» [стр. 25]; «third party service… machine learning to generate walls, doors and windows in (near) realtime» [сниппет: floorplanner.readme.io/reference/vloor]. Подписи размеров с плана никто не читает [не найдено].

### 2.8 Электрика, инженерка, сметы

- Только символы: «We have a library of symbols for electric plans, plumbing plans etc.» [проверено: стр. 44]. Групп, кабелей, щита, проверок норм — нет [не найдено]. Смет/бюджета — нет [не найдено]; есть «list of all items and materials used in this plan… download this list» [проверено: стр. 22].

### 2.9 3D, рендер, VR, AR

- Мгновенный 3D (dollhouse / first person), правка объектов в 3D, камеры на этаж с высотой/углом/FOV, fly-through, «Light and Scene» (время суток, погода, 360°-пейзаж или своя панорама, STUDIO-фон) [проверено: стр. 14–19]. Рендеры SD/HD/4K/8K по «уровню проекта» [стр. 20]; **VR 3D tour** — ссылка, «materials and light settings are “baked” into the VR model» [стр. 21]; публичные примеры floorplanner.com/360vr/… [сниппет].
- AR — только «Product Viewer» для ритейла (товар в своей комнате), не план [сниппет: floorplanner.com/productviewer].

### 2.10 Экспорт, печать, масштаб, DXF/PDF

- 2D: JPG/PNG/PDF; «When you export as a PDF… choose a paper size and a certain scale for your exports, for instance A3. You always have to check carefully with a known size in your plan if the print is really done on scale»; «PDF in multiple pages, where every floor is in the same scale» [сниппет: help …/8439821]. 3D-экспорты уходят на e-mail [проверено: стр. 58].
- **DXF:** «You can now export your floorplanner projects (walls, doors, windows) as a 2D DXF file» [сниппет: x.com/floorplanner, 2022]; FML — родной формат [сниппет]. Боль: «it only exports DXF files that require conversion, and the files are a mess with all shapes broken apart into individual lines, bezier curves are lost, text labels are converted to little lines, and furniture is not exported at all» [сниппет: Trustpilot].
- Импорт DXF/DWG — не найден; старая брошюра советует «export it to a .png or .jpg image file with maximum 3000×3000» [проверено: FPTricks_DrawingAngledPlans.pdf].
- Free: экспорт 960×540 с водяным знаком и «10 minute cooldown between exports» [сниппет: floorplanner.com/basic]; «wanted to charge them $5 to save a floor plan to A4 size» [сниппет: Trustpilot].

### 2.11 Облако, совместная работа, версии

- Автосохранение, undo/redo в шапке [проверено: стр. 3]. **История версий:** «Restore older version» / «Retrieve older versions» в меню дизайна [проверено: стр. 4, 22]. Этажи и «дизайны» (варианты интерьера/планировки на этаж), поворот/зеркало всего дизайна, pivot для совмещения этажей, «Tip: switch between floors with < >» [стр. 22–23].
- Совместная работа: «share tab → collaborate option and invite additional users» [сниппет: help …/2391426]. Enterprise: «as many users as you need… user roles… APIs… white labelled… insights in all the projects and exports» [сниппет: floorplanner.com/enterprise].

### 2.12 Мобильные приложения

- Только браузер; собственного приложения для черчения нет [не найдено; упоминание «view it on your smartphone with the Floorplanner app» в агрегаторе — не подтверждено]. Конкурент: «user interface can feel less intuitive when working on detailed projects or smaller devices» [сниппет: roomsketcher.com/blog/floorplanner-vs-roomsketcher — заинтересованный источник].

### 2.13 Онбординг, обучение, шаблоны

- Вход через Dashboard → проект → редактор; `?` показывает шорткаты в сайдбаре [проверено: стр. 10, 59]; PDF-мануал, YouTube-уроки («Lesson 1: Upload image», «Lesson 3: Doors and Stairs»), вебинары [сниппеты]. Встроенного пошагового тура в редакторе — не найдено [не найдено]. Библиотека Room types (Pro — свои наборы), Roomstyles/Styleboards как «шаблоны стиля» [проверено: стр. 42, 55–56]. Обзоры: «Floorplanner has the steepest learning curve among comparable tools, 7.0/10» [сниппет: remodelai.io], при этом другие — «very intuitive» [сниппет: Capterra] [противоречие].

### 2.14 Ограничения free-версии и цена

- Basic: до 5 проектов, 3 этажа/3 дизайна, SD 960×540 с водяным знаком, cooldown 10 мин, 0 кредитов [сниппеты: floorplanner.com/basic, /pricing]. Plus $5/мес (4 кредита), Pro $29/мес (25 кредитов) [сниппет: theclose.com; roomio.io]. Кредиты: «$8.15 for five up to $163.00 for a hundred», тратятся на «уровень проекта» (HD 1920×1080, 4K, 8K), 3D-туры, styleboards [сниппет: floorplanner.com/pricing]. Отзыв: «the credits model is bs but, fairly common» [сниппет: Trustpilot].

### 2.15 Сильные стороны Floorplanner

1. Автоматические внутренние **и наружные** размеры с прямым редактированием через число + стрелка (стр. 26, 46).
2. Ввод числа **во время** перетаскивания (длина стены, ниша, линия, размерная линия) — единый приём по всему редактору (стр. 27, 28, 34, 45, 47).
3. Множественный выбор с фильтром по типу, группами и копипастом между этажами (стр. 12–13).
4. «Move wall across axis» — честное решение проблемы «грань прыгает при разной толщине» (стр. 30).
5. Нулевая стена для зон + Magic Layout понимает открытую сторону (стр. 32).
6. Версии дизайна и «Restore older version» (стр. 4, 22).
7. Экспорт PDF в масштабе с многостраничностью и DXF (пусть и кривой).

---

## 3. RoomSketcher

### 3.1 Рисование стен

- Режимы приложения переключаются кнопками/цифрами: «1 for Walls, 2 for Windows, 3 for Materials, and 4 for Furniture», `Ctrl+T` — настройки [сниппет: help …/115005652169].
- **Инструменты Draw Exterior Walls / Draw Interior Walls (Thick/Thin):** «set wall thickness first by opening Walls mode, clicking either the Draw Exterior Walls tool or Draw Interior Walls tool, changing the Thickness, and then drawing»; «While you are drawing, you can use + and – keys to make the wall thicker or thinner»; «The minimum wall thickness that you can set is 2 inches (50 mm)» [сниппет: help …/360000827249].
- **Щелчки:** «click once where you want your wall to start, move the mouse cursor to where you want the wall to end or turn», «click each time it turns, and click where it ends against the outside wall»; свободный конец: «click where you want the wall to end, and then press ESC on your keyboard, or click the Select tool» [сниппеты: help …/208845045, …/202190252]. На планшете: «tap once where the wall starts, place your finger on the screen, and drag to move the cursor, then tap again where the wall should end» [сниппет: help …/115000026785].
- **Комната (zone)** возникает автоматически из замкнутого контура; «Divider tool to create balconies, outside areas, railings and several zones in one room (…open kitchen/living room area)» [сниппет: help …/202190252]; «Any zone or area can be turned into a wall» [сниппет: help …/360000827249].
- **Привязка:** «Snapping… will help you place walls along the closest wall or furniture item»; Menu → Snapping (галочка); «press the Ctrl (or Cmd on Mac) key to prevent snapping while moving» [сниппет: help …/115001610525]. Сетка — только визуальная подсказка: «A grid provides visual clues… to help estimate wall lengths» [сниппет: help …/115003084145].
- **Углы:** орто-режима/угловых шагов в справке нет [не найдено]. Диагонали делают «add two helper walls and then add diagonal walls on each side… use the same angle for each of the side walls, for example 45 degrees» [сниппет: help …/360000814049 (bay windows)]. Отзыв App Store: «difficult to build walls that are not in a straight line, as the app is set to turn at certain angles which can be inappropriate for older homes with non-standard angles» [сниппет: apps.apple.com]. Кривые стены — Pro-фича [сниппет: roomsketcher.com/features/pro-features/curved-walls].
- **Точная длина при рисовании и после:** «click or tap a wall end so that arrows appear. Then, type the exact length in inches or millimeters in the boxes to the right. The length will increase or decrease on the side with the arrows… Press Enter or click/tap outside of the Length box»; «You can do this during the drawing process or after you've placed the walls» [сниппет: help …/360000202509]. Минимум — «the shortest wall length you can enter is 4 inches (100 mm)» [сниппет: там же].

### 3.2 Правка стен и комнат

- **Щелчок по стене:** «click on the end of a wall so that the wall turns blue, then in the right pane you can type an exact wall length for the inside or outside edge of the wall» [сниппет: roomsketcher.com/blog/roomsketcher-drawing-tips-tricks]; в Properties справа — Thickness («type the new thickness and press Enter»), Wall Material / Material Side A / Side B, Advanced → Wall Top Color; «change dimensions by dragging the large blue arrows next to the wall» [сниппеты: help …/360000827249, …/360000344649, …/360000835785]. Половинная стена — отдельная статья «Create a Half-Height Wall» [сниппет].
- **Inside vs outside:** «If a wall is connected to other walls, the inside and outside lengths will differ because of the wall's thickness — the inside edge is always a bit shorter than the outside edge» [сниппет: help …/360000827249] — та же модель, что у нас «внутри 390 / снаружи 410» (README:86).
- **Что с соседями при правке:** «in some cases, when you change the length of one wall, it will also adjust the length of walls connected to it»; ручная растяжка мышью «works if the wall is not connected to another wall» [сниппет: help …/360000202509]; «when a wall is connected at a non-90-degree angle, you won't be able to adjust its length» [сниппет: help-центр]. Перемещение: «click and drag it into place» [сниппет]; правила «только поперёк» нет [не найдено].
- **Ниша / сплит:** отдельной операции split в справке не найдено [не найдено]; по памяти — новая стена, начатая на существующей, делит её сама [по памяти].
- **Множественный выбор — нет:** «Currently, you can not multi-select individual items to create your own grouped sets. …you can activate the setting Multi Insert of Item» [сниппет: help …/14546892866205]; копирование мебели/дверей/окон — по одному [сниппет: help …/4408650564497]. Жалоба: «copying and duplicating items becomes cumbersome when managing multiple apartments» [сниппет: Capterra/G2].
- **Масштабирование всех стен:** «all walls in your project change size by the percentage you choose… while other items like furniture, doors, windows, and stairs stay the same size» [сниппет: help …/360000048978] — полезно, когда обведённый план оказался не в масштабе.
- Замок стен — [не найдено].
- Жалобы: «dragging and dropping wall outlines is complicated, and while it looks easy in the demo, it's not as simple in actual use»; «way too many frustrating things that waste my time» [сниппеты: apps.apple.com]; Google Play: «“snap in place” movement… don't “snap” to where expected», ответ поддержки — «use the CTRL key or turn off snapping completely» [сниппет: play.google.com].

### 3.3 Размеры и единицы

- Единицы: Menu → Tools → Meters / Feet (`Ctrl/Cmd+T`); «Meters will display… centimeters and millimeters» [сниппет: help …/115003084245]; ввод длин — в мм/дюймах [сниппет: help …/360000202509].
- **Семь типов размеров:** Room Area, Room Dimensions, Room Measurements, Outside Measurements, Wall Measurements, Total Area, Manual [сниппет: roomsketcher.com/blog/the-7-measurement-types]. **Мастера (Pro/Team):** «Room Measurements: along all the inside walls of a room. Wall Measurements: a single wall, either inside or outside. Room Dimensions: overall length and width in the center of each room. Outside Measurement: total length and width of your entire floor plan»; «just click in each room and the correct measurements magically appear» [сниппеты: help …/115005898829; roomsketcher.com/features/pro-features/measurements]. Настройки мастера: «distance between measurement lines and walls, minimum line length, font size, whether decimals use a period or comma» [сниппет: help …/115005896685]; Room Dimensions могут показывать обе системы единиц «secondary units below in brackets» [сниппет].
- Размеры — объекты: «move, delete, and change properties such as text size, line length, and whether they should appear on 2D or 3D Floor Plans» [сниппет]. Ручные: Measuring Tape (центр — двигать, дуга — вращать, диагонали — размер) и Measure Line без стрелок [сниппет: help …/115000020785, …/14866571807005]. Площадь комнаты — «Show Zone Size», подпись комнаты перетаскивается; общая площадь плана — отдельный раздел Total Area [сниппеты].
- Размер стены в чистоте — через Wall Measurements inside; наружный габарит всего плана — Outside Measurement. У нас есть первое (README:14, `roomDims`, `PlannerPage.tsx:2344`), нет второго.

### 3.4 Двери, окна, проёмы

- Режим «Windows etc.» (2): «click to select a door and then click on a wall to place it»; «if the door is wider than the wall's length, it can't be added»; «To change the direction of the swing, click Flip Door or use the hotkey Q» [сниппет: help …/360000808925]; окна — drag на стену, типы casement/double-hung/sliding [сниппет: help …/360000818165]; **проём без двери** — элемент «door and wall opening — a walk-through space with no actual door» [сниппет: help …/360000808925]; амбарные двери, эркеры — отдельные статьи. Replace Materials — рамы, наличники, фурнитура (Pro) [сниппет: roomsketcher.com/features/replace-materials].

### 3.5 Каталог

- Free: «4,000+ furniture and material items», Pro: «complete furniture library» [сниппеты: help …/360019791538; roomsketcher.com/pricing]. Building Blocks — свои объекты из примитивов [сниппет: help …/18710142942493]; Best Fit — автоподбор размера [сниппет: help …/360000414245]; Replace Materials — цвет/материал предмета с иконкой-палитрой (Pro) [сниппет: help …/115001446489].
- Жалобы: «some common furniture pieces are unavailable»; «unable to change the color of furniture while placing them… unless you publish in 3D view»; «wish recliners looked more like recliners»; «inability to import custom materials» [сниппеты: Capterra/G2/GetApp].

### 3.6 Отделка

- Режим Materials (3): полы/стены, поворот материала на угол (например 45°) [сниппет: help …/360000840069]; цвет верха стены; кухонные фасады/столешницы через Replace Materials [сниппет: help …/360000358905]; Room Types + Room Colors для 2D-плана; «ready-made templates… each template instantly applies a complete set of colors and materials» [сниппет: help …/360014253018].

### 3.7 ИИ-функции

- **AI Convert:** «upload your floor plan as a JPG, PNG, or PDF and let AI map out your walls, doors, and windows in seconds»; «computer vision algorithms recognize walls, doors, windows, and stairs, then maps those detections into the standardized geometry»; «a modest one-bedroom, 430-square-foot floor plan takes roughly three minutes [вручную]… AI Convert… around five seconds»; «also straightens the document when it's captured at skewed or uneven angles» [сниппеты: roomsketcher.com/features/ai-convert; /news/roomsketcher-launches-ai-convert]. Подготовка в портале: Straighten («let RoomSketcher's AI Agent fix the alignment»), Rotate (по 90°), Crop (серые линии) [сниппет: help …/213842649]. **Масштаб — руками:** «AI Convert needs one known measurement… Even if your blueprint shows measurements, these aren't detected automatically» [сниппет: help …/35537884534429]; для ручной обводки — «drag the Scale Bar along a wall that you know the exact length of, and click Set Length» [сниппет: help …/213842649]. **Ограничения:** «works best with clear, computer-generated 2D floor plans»; «If the walls… are only single thin lines (without thickness or borders), the AI may not recognize them as walls»; «grey background with faint lines… may struggle»; «text, stamps, or borders can confuse the AI» [сниппет: help …/35537884534429]. Доступ: Free/Pro/Team, «Your first AI Convert is free»; без подписки «$20 per floor», с подпиской — кредиты [сниппеты].
- **AI Render:** из Snapshot в веб-портале, пресеты стилей, «text prompts and image references»; «0.10 Credits each… deducted in bundles of 1 full Credit»; бесплатным — до 10 [сниппет: roomsketcher.com/features/ai-render; help …/115003158269].
- **FloorCapture:** LiDAR-приложение (iPhone 12 Pro+/iPad Pro 2020+), «5–10 minutes to capture a medium-sized property… instantly converted into RoomSketcher geometry», beta [сниппет: help …/32565565852317].
- Авто-расстановки мебели (аналога Magic Layout) — [не найдено].

### 3.8 Электрика, инженерка, сметы

- «How Do I Create an Electrical Plan in RoomSketcher?» — «more than 270 electrical symbols… power outlets, various switch types, wires, light fixtures, fans, smoke detectors, fire alarms», drag-and-drop, «symbols follow common industry conventions» [сниппеты: help …/12794506158493; roomsketcher.com/floor-plans/electrical-drawing-software]. Групп, нагрузок, щита, проверок — нет [не найдено]. Смет — нет [не найдено]; в Project Presentation есть список использованной мебели [сниппет: help …/33069938218781].

### 3.9 3D, рендер, VR, AR

- **Live 3D (Pro; кредитов не тратит):** «Flyover Mode… Camera Mode to walk through your project in first person»; «see updates as you edit»; стрелки — 10 см, с Shift — 100 см [сниппеты: roomsketcher.com/features/live-3d-floor-plans; help …/360015182577]. Из Live 3D — 360 Views, Snapshots, AI Render, ссылка Share Live 3D. Snapshots «saved in low resolution and use simplified lighting», на Free с водяным знаком; 3D Photos, 360 Views, 3D Floor Plans — за кредиты [сниппеты: help …/208846525; checkthat.ai].
- VR/AR — [не найдено]. Жалоба (старая): «the inability to view the 3D models on a mobile device» [сниппет: Capterra].

### 3.10 Экспорт, печать, масштаб

- Форматы: «JPG, PNG, or PDF»; «RoomSketcher does not support CAD-compatible or other editable file formats» [сниппет: help …/360001709837]. **В масштаб:** «choose a letterhead with a built-in scale… choose various formats, sizes as well as a scale (e.g., 1/2"=1'-0")»; «Scale options are only available in PDF format and when choosing Save to Disk»; при печати «choose Actual size» [сниппеты: help …/21708083291933; …/202332952]. 2D-планы бесплатны для Pro/Team; Free — платно за план [сниппет: checkthat.ai — сумма «$4» не подтверждена официальной страницей].
- Профиль 2D-плана: «All furniture / Fixed installations / No furniture»; показать «measurements, room names, room sizes, and furniture labels… room colors» [сниппет: help …/360014253018]; несколько профилей на аккаунт, брендинг (Pro).

### 3.11 Облако, совместная работа, версии

- Синхронизация между устройствами [сниппет: help …/115000026785]. Team: «Up to five users… each user getting their own individual login and access to both their own projects and all shared projects», роли [сниппет: help …/202619022]. Project Presentation — автоматическая страница проекта по ссылке [сниппет: help …/33069938218781]; перенос проекта между аккаунтами через Share URL → Open in App [сниппет: help …/360011440278].
- Версии: «add a new version as a level within the same project, or make a copy of your project»; «A copied project counts as a new project and costs 1 Credit» [сниппет: help …/360000570249]. Истории версий/восстановления — [не найдено].

### 3.12 Мобильные приложения

- «The RoomSketcher app is not available on phones, but is available on Mac and Windows computers, as well as iPads and Android tablets»; на телефоне — только веб-портал: «see all your projects, convert, order, and generate floor plans» [сниппет: roomsketcher.com/download-iphone]. Планшет — «full functionality of the desktop version, optimized for touch» [сниппет: roomsketcher.com/features/mobile].
- Боли: «no longer supported on mobile devices except tablets… 99% of users are more likely to have a phone than a tablet»; «doesn't run properly on Samsung S23 Ultra… app cut off around the edges and pop-up menus not loading» [сниппеты: play.google.com]; рейтинг планшетного приложения 2.62/5 (270) [сниппет].

### 3.13 Онбординг, обучение, шаблоны

- «New to RoomSketcher? Start Here» и «Getting Started: 5 Ways to Create Your Floor Plan»: «draw a floor plan from scratch, capture a space using LiDAR, upload and convert an existing plan with AI, trace over a blueprint manually, or have experts redraw it for you» [сниппеты: help …/35581805358877; …/35025532311709]. Новый уровень: «Start from Scratch / Copy an existing level (Include furniture) / Use an existing floor plan shape — pick from a selection of ready-made floor plan shapes» [сниппет: help …/360000107249]. Шаблоны стиля 2D-плана; «Can I Preview a Floor Plan?» — предпросмотр до траты кредитов [сниппет]. Языки приложения включают русский; веб-портал — EN/SV/NO/DE/DA [сниппет: help …/360000570109, …/202345761].

### 3.14 Ограничения free-версии и цена

- Free: «up to 2 projects, 4,000+ furniture and material items, projects in meters or feet with precise measurements, AI Convert (first free), 3D Snapshots and AI Render»; нет Live 3D, 360, полной библиотеки, мастеров размеров; снимки с водяным знаком [сниппеты: help …/360019791538; checkthat.ai]. Pro «$144.00 per user, per year» (5 кредитов/мес), Team «$420.00/year» (20 кредитов/мес, 5 пользователей) [сниппеты: Capterra; roomsketcher.com/pricing]. Кредиты: «Credits Refill Micro… 5 Credits for USD 20», «Large pack ($1,100 for 500 credits at $2.20 each)» [сниппет: roomsketcher.com/credits]; новый проект — 1 кредит, копия проекта — 1 кредит; 3D Floor Plans / 3D Photos / 360 — за кредиты; перерисовка людьми — $38/этаж (Free) или $20–35 кредитами (Pro/Team) [сниппеты].
- Боли: «wished there was better information explaining credits… 5 of their credits were wasted»; «after paying an annual fee, customers have to pay more to be able to share»; «charged $20 every month… only refund within the first 30 days»; «kept charging €25 per month without sending invoices» [сниппеты: Trustpilot].

### 3.15 Сильные стороны RoomSketcher

1. Ввод длины с явной стороной роста (стрелки на конце) и раздельно inside/outside — прямо в панели свойств.
2. Толщина стены ±/– клавишами прямо во время рисования; отдельные пресеты «наружная/внутренняя».
3. Мастера размеров: комната, стена, габарит комнаты, габарит плана — одним щелчком; настройки отступа, минимальной длины, шрифта, разделителя дробей.
4. AI Convert: 5 с, выпрямление перекоса, честный список причин неудачи; первый бесплатно.
5. Live 3D без кредитов с правкой в реальном времени.
6. Онбординг «5 способов начать» + готовые формы плана для нового уровня.
7. Русский язык интерфейса приложения.

---

## 4. Матрица по категориям

| Категория | Floorplanner | RoomSketcher | У нас (`/home/user/3d`) |
|---|---|---|---|
| Рисование стен | Draw Room (прямоугольник), Draw Wall (click-drag, длина числом + Enter), Draw Surface; толщина числом до рисования; направляющие, `S` — без привязки; орто-режима нет | Exterior/Interior tools с толщиной; `+/–` толщина во время рисования (мин. 50 мм); click-click-click, Esc — свободный конец; Ctrl — без привязки; угловых шагов нет | По точкам и прямоугольником, привязки к концам/осям/Т-стыкам/сетке и 0/45/90°; длина цифрами во время рисования (`PlannerCanvas.tsx:998-1013`); толщина — поле `wallThickness` |
| Правка стен/комнат | Клик → сайдбар (стороны, толщина, высота, raise), двойной клик → настройки; сплит, кривая, стена из точки, удалить сегмент; ниша = 2 сплита + тянуть с вводом числа; «move wall across axis»; невидимая стена 0 | Клик → синяя стена, стрелки на концах, поля inside/outside; толщина; соседи меняются при правке; не-90° — длину не ввести; сплита/замка не найдено; Scale all walls % | Прямая целиком, тянуть только поперёк с примыкающими; Alt — участок (ниша/выступ/проём); стрелки 1/10 см; замок стены/всех (`walledit.ts:494,502`); `normalizeWalls` |
| Размеры и единицы | Авто внутренние + наружные, клик по размеру → число + стрелка; настройки (короткие, наружные, масштаб подписи, горизонтально); ручные `d` с вводом при рисовании; м/фут (ввод в см — жалобы) | 7 типов; мастера Room/Wall/Room Dimensions/Outside (Pro); настройки отступа/шрифта/разделителя; мм/дюймы; вторая система в скобках | Размер каждой стороны комнаты в чистоте; «по оси/внутри/снаружи»; размеры привязаны к стенам и следуют за правкой (`dims.ts: followDims`); наружного габарита нет; см/мм/м |
| Двери/окна/проёмы | Библиотека, drag на стену, автоснап, сторона/петли иконками, ширина/высота/raise, «открыть дверь» в 3D | Клик-клик, ширина не больше стены, Flip Door / `Q`, «door and wall opening», типы окон, Replace Materials на рамах | Прилипают к стенам, сектор открывания, петли с другой стороны (`PlannerPage.tsx:2255`), проёмы |
| Каталог | 150 000+, бренды, фильтр «resizable», similar items, избранное | 4 000+ Free / полная в Pro; Building Blocks; Best Fit; Replace Materials | ~60 предметов с реальными размерами + Poly Haven CC0 (README) |
| Отделка | Краски по производителям, hex, материалы, штриховки, front view стены, картинка на стене | Материалы полов/стен с поворотом, Replace Materials, Room Colors, шаблоны стиля | Базовые цвета/материалы [по README — минимально] |
| ИИ | Magic Layout (тип комнаты + стиль, повторить/ре-стайл, без проверок); AI image enhancement за токены; распознавание плана — через партнёра Vloor | AI Convert (5 с, выпрямление, масштаб руками, подписи не читает); AI Render; FloorCapture LiDAR; авто-расстановки нет | Распознавание БТИ с чтением подписей и сверкой площадей (`planai.ts`); ИИ-расстановка с проверкой геометрией и отчётом (`furnish.ts`, `checks.ts`) |
| Электрика/инженерка/сметы | Символы электрики/сантехники; список предметов | 270+ символов; drag-and-drop | Группы щита, кабель, автоматы, ПУЭ-замечания (`electricplan.ts`) |
| 3D/рендер/VR/AR | Dollhouse/first person, камеры, свет/сцена, SD…8K, VR-тур по ссылке; AR только для товаров | Live 3D (Pro, без кредитов), Snapshots/3D Photos/360 за кредиты; VR/AR нет | 3D + AR через камеру телефона (README) |
| Экспорт/печать/масштаб | JPG/PNG/PDF с форматом листа и масштабом, многостраничный PDF, DXF (кривой), FML | JPG/PNG/PDF с letterhead-масштабом (только PDF + Save to Disk); CAD-форматов нет | JSON, SVG, PNG, CSV (`exporters.ts`); PDF/масштаба листа/DXF нет |
| Облако/совместная работа/версии | Автосейв, Restore older version, этажи и дизайны, collaborate по приглашению, Enterprise API | Синхронизация, Team 5 пользователей + роли, Project Presentation, версии = копия уровня/проекта (1 кредит) | Локально + автосохранение, ссылка для телефона (README:269); версий нет |
| Мобильные | Только браузер | Планшеты полноценно; телефон — только просмотр/заказ | Браузер + Telegram Mini App, AR на телефоне |
| Онбординг/шаблоны | Дашборд → редактор, `?`, мануал, видео; room types, styleboards | «5 ways to start», готовые формы плана, шаблоны стиля, предпросмотр до кредитов | StartDialog с «Загрузить свой план», шаблоны (`templates.ts`) |
| Free/цена | 5 проектов, 3 этажа, SD с водяным знаком, cooldown 10 мин; Plus $5, Pro $29; кредиты $1.63–$1.95 | 2 проекта, 4 000 предметов, 2 кредита, первый AI Convert; Pro $144/год, Team $420/год; кредит $2.20–$4 | Бесплатно |

---

## 5. Что из этого стоит взять нам и почему

Оценка: польза — высокая/средняя/низкая; цена — дни одного разработчика на текущем коде.

1. **Сторона роста при вводе длины** (RoomSketcher — стрелки на конце; Floorplanner — стрелки у размера). Сейчас `setRunLengthBy` (`walledit.ts:235`) и поле в панели (`PlannerPage.tsx:2142`) не спрашивают, какой конец двигать. Сделать: в панели рядом с длиной переключатель «⟵ / ⟶ / от центра», дефолт — свободный конец (не упирающийся в замкнутую стену), чтобы не повторять жалобу «have to say which way to expand». Польза высокая, 2–3 дня.
2. **Число во время перетаскивания** (Floorplanner, стр. 28: синяя стрелка до противоположной стены + ввод + Enter). У нас во время `pushRun` уже есть подпись «сдвиг N см» (`PlannerCanvas.tsx:850-877`); добавить перехват цифр как при рисовании (`998-1013`) и показывать не только сдвиг, но и расстояние до ближайшей параллельной стены/грани комнаты. Польза высокая, 2–3 дня.
3. **Множественный выбор** (Floorplanner: Shift + рамка, Shift + клик, фильтр «только стены / только мебель», группа, дублировать/зеркалить/удалить, копипаст в другой проект). `Selection` — единичный (`types.ts:212-217`), поэтому это рефакторинг: `Selection = { kind: 'multi'; ids }` + операции над множеством + учёт замков (`touchesLocked`). RoomSketcher без этого получает жалобы «cumbersome when managing multiple apartments». Польза высокая, 5–8 дней.
4. **Клик по автоматическому размеру стены = поле ввода** (Floorplanner, стр. 46). У нас щелчок по подписи стороны комнаты уже редактирует её (`sideEdit`, `PlannerPage.tsx:1491`); распространить на подпись длины выбранной стены и на привязанные размерные линии (`dims.ts: addDimRef`): ввод числа двигает тот конец, что привязан к «более свободной» стене. Польза средняя, 2 дня.
5. **Наружный габарит плана и «размеры всех комнат» одним щелчком** (RoomSketcher Outside Measurement / Room Measurements; Floorplanner exterior dimensions). У нас `roomDims` кладёт размеры одной комнаты (`PlannerPage.tsx:2344`); добавить кнопки «Размеры всех комнат» и «Габарит плана» в меню «Вид», плюс настройки отступа от стены и минимальной длины (RoomSketcher Measurement Wizard Settings). Для техпаспорта это привычный вид. Польза средняя, 2–3 дня.
6. **Переключатели вида размеров** (Floorplanner, стр. 49: скрыть короткие, скрыть наружные, масштаб подписи, подписи горизонтально/вдоль, скрыть всё). Дешёвый способ получить «чистый план для печати». Польза средняя, 1–2 дня.
7. **PDF в масштабе с форматом листа** (оба; Floorplanner ещё и многостраничный по этажам с одним масштабом, RoomSketcher — только PDF + «Actual size»). У нас только SVG/PNG/JSON/CSV (`exporters.ts:16-29`). Сделать экспорт «PDF A4/A3, масштаб 1:50/1:100, рамка и штамп с площадями» через SVG → PDF на клиенте; печатать «проверьте отрезок 1 м» как советует Floorplanner. Польза высокая для тех, кто несёт план в БТИ/подрядчику, 3–5 дней.
8. **DXF-экспорт стен/проёмов** (Floorplanner; RoomSketcher не умеет вовсе — отличие). Писать стены полилиниями по граням, двери/окна блоками, размеры — DIMENSION, подписи — TEXT, чтобы не повторить их «shapes broken apart… text converted to little lines». Польза средняя (подрядчики/дизайнеры), 3–4 дня.
9. **«Сдвинуть стену поперёк оси» степпером для выравнивания граней** (Floorplanner, стр. 30). `pushRun` (`walledit.ts:314`) уже умеет сдвиг с примыкающими; добавить в панель числовое поле «сдвиг поперёк, см» и кнопку «выровнять внутреннюю грань с соседней». Польза средняя, 1–2 дня.
10. **Нулевая стена / делитель зон** (Floorplanner «invisible wall thickness 0», RoomSketcher «Divider tool»). Нужно для кухни-ниши и гостиной-столовой в одной комнате: отдельные подписи, площади и — важно — раздельная ИИ-расстановка по зонам, где делитель считается открытой стороной (как у Magic Layout). Польза средняя, 2–3 дня (тип `divider` в `types.ts`, `rooms.ts` делит полигон, `furnish.ts` учитывает открытую сторону).
11. **Толщина стены клавишами во время рисования** (`+`/`–` у RoomSketcher, «type thickness + Enter» у Floorplanner). У нас толщина — поле `wallThickness` в тулбаре; добавить `[`/`]` и подсказку у курсора рядом с набранной длиной. Польза низкая, 0.5–1 день.
12. **«Почему не распозналось»** (RoomSketcher «Why Didn't My AI Convert Work»: одиночные тонкие линии, серый фон, текст/штампы/рамки). У нас есть «Выровнять / Выпрямить по 4 углам / Очистить» и отчёт; добавить в диалог «Распознано» диагностику по тем же признакам (доля тонких линий, контраст, доля текста у стен) с советом «обрежьте рамку» / «увеличьте контраст». Польза средняя, 1–2 дня.
13. **Перемасштабировать все стены на %, не трогая мебель** (RoomSketcher). Ситуация: обвели по подложке с неверной калибровкой, потом узнали площадь. У нас есть калибровка подложки и масштаб по площади комнаты для распознавания; добавить ту же операцию для уже нарисованных стен с сохранением размеров дверей/мебели. Польза низкая/средняя, 1 день.
14. **Стартовый экран «как начать» в 4 плитки** (RoomSketcher «5 ways»: с нуля / скан / ИИ-конвертация / обвести / заказать) + готовые формы контура для нового плана. У нас `StartDialog.tsx` с «Загрузить свой план» и шаблонами; оформить как явный выбор пути с одной фразой про то, что делать дальше, и добавить 4–5 типовых контуров квартиры (студия, 1к, 2к линейная, 2к распашонка). Польза средняя, 1–2 дня.
15. **История версий «восстановить старую версию»** (Floorplanner «Restore older version»; у RoomSketcher её нет и версии стоят кредит). У нас есть undo и автосохранение; хранить снимки плана по времени в IndexedDB/файле проекта с списком «сегодня 12:40, 27 стен, 18 предметов». Польза средняя (страховка от «испортил одним движением»), 2 дня.

### Что у нас уже сильнее обоих (не трогать, а показывать в онбординге)

- **Ниша/выступ/проём одним жестом** (Alt + тянуть, Alt + клик + Del; README:82, 85) против «split дважды и тяни» у Floorplanner и отсутствия документированного сплита у RoomSketcher.
- **Стена — прямая целиком, тянется только поперёк, примыкающие едут за ней, `normalizeWalls` склеивает** (`walledit.ts:46, 314, 367`) — против «corners too close… rooms won't show» и «walls connected in different directions — would not let me move one side» у Floorplanner.
- **Размеры, привязанные к стенам и следующие за правкой** (`dims.ts: followDims`) — у Floorplanner ручные размерные линии после «convert to separate» живут сами по себе.
- **Замок на конкретную стену с объяснением, почему правка не применилась** (README:92) — у Floorplanner замок по категориям, у RoomSketcher не найден.
- **Распознавание, читающее подписи размеров и площадей** — RoomSketcher прямо пишет «these aren't detected automatically», Floorplanner отправляет к партнёру за кредиты.
- **ИИ-расстановка с проверкой геометрией и отчётом об отброшенном** — Magic Layout только «повтори ещё раз».
- **Электрика как проект** (группы, кабель, автоматы, ПУЭ) — у обоих только символы.

---

## Приложение: источники

**Первичные (PDF, текст вынут):** `audit/fp-src/floorplanner-manual-2022.txt` (Floorplanner Editor Manual 11/2022, https://fpcdn.s3.amazonaws.com/static/brochures/Floorplanner+editor+manual+11+2022.pdf); `audit/fp-src/repairing.txt` (http://fpcdn.s3.amazonaws.com/static/brochures/FPTricks_RepairingYourFloorplan.pdf); `audit/fp-src/angled.txt` (http://fpcdn.s3.amazonaws.com/static/brochures/FPTricks_DrawingAngledPlans.pdf).

**Floorplanner (сниппеты):** https://help.floorplanner.com/en/articles/8437038 (exact measurements of a wall), /8437051 (split a wall), /8545008 (select multiple objects), /8438764 (short dimension lines), /8441241 (structure length/width/height), /8439089 (place a door), /8439821 (PDF export), /8448959 (Magic Layout with Styleboard), /8437043 (color/material to a wall), /2391426 (collaborate); https://floorplanner.com/basic, /pricing, /enterprise, /project-levels, /productviewer; https://floorplanner.readme.io/reference/vloor; https://updates.floorplanner.com/ (AI tokens); https://x.com/floorplanner/status/29668825821 (S = no snap), /1507014153726136329 (DXF export), /1399388804985802779 (Magic Layout outdoor); https://www.facebook.com/floorplanner/videos/copy-and-paste-multiple-walls/761880644322785/; https://www.capterra.com/p/164017/FloorPlanner/reviews/; https://www.trustpilot.com/review/floorplanner.com; https://www.techradar.com/reviews/floorplanner; https://machow2.com/floorplanner-review/; https://www.remodelai.io/blog/best-free-ai-floor-plan-apps; https://theclose.com/best-floor-plan-software/; https://www.coohom.com/article/how-to-upload-a-2d-floor-plan-to-floorplanner (конкурент).

**RoomSketcher (сниппеты):** https://help.roomsketcher.com/hc/en-us/articles/360000202509 (exact lengths), /360000827249 (thick and thin walls), /115001610525 (snapping), /115003084145 (grid), /360011828238 (settings that speed up drawing), /115005652169 (hotkeys), /14546892866205 (multi-select — нет), /4408650564497 (copy/paste items), /360000048978 (scale all walls), /115005898829 (measurement wizards), /115005896685 (wizard settings), /360000216525 (measurement overview), /115000020785 (tape measure), /14866571807005 (measure line), /115003084245 (units), /360000808925 (doors, Flip/Q, opening), /360000818165 (windows), /360000814049 (bay windows), /31885247016605 (AI Convert), /35537884534429 (Why didn't AI Convert work), /213842649 (draw from blueprint, Scale Bar), /360001708977 (preparing blueprints), /32565565852317 (FloorCapture), /12794506158493 (electrical plan), /360015182577 (Live 3D navigation), /208846525 (snapshots), /115003158269 (credits), /360019791538 (free subscription), /21708083291933 (download/print), /202332952 (print to scale), /360001709837 (no CAD formats), /360014253018 (2D floor plan options), /360000107249 (levels), /360000570249 (versions), /202619022 (users), /33069938218781 (project presentation), /360011440278 (move project), /35581805358877 (start here), /35025532311709 (5 ways), /115000026785 (tablet), /360000570109 и /202345761 (languages), /202190252 и /208845045 (first floor plan); https://www.roomsketcher.com/features/ai-convert/, /news/roomsketcher-launches-ai-convert/, /features/live-3d-floor-plans/, /features/ai-render/, /credits/, /pricing/, /download-iphone/, /features/mobile/, /blog/roomsketcher-drawing-tips-tricks/, /blog/the-7-measurement-types-in-roomsketcher/, /order-floor-plans/, /blog/floorplanner-vs-roomsketcher/ (заинтересованный); https://www.capterra.com/p/164021/RoomSketcher/reviews/; https://www.trustpilot.com/review/roomsketcher.com; https://apps.apple.com/ru/app/roomsketcher/id1082324789; https://play.google.com/store/apps/details?id=com.roomsketcher.homedesigner; https://checkthat.ai/brands/roomsketcher/pricing; https://www.g2.com/products/roomsketcher/pricing.
