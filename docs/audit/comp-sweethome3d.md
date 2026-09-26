# Sweet Home 3D и его трекер пожеланий; Cedreo / Foyr Neo как «профи за деньги»

Дата: 2026-09-26. Метод: трекер Sweet Home 3D на SourceForge прочитан напрямую (curl + разбор HTML): список открытых пожеланий, отсортированный по голосам (`sort=votes_total_i desc`, 766 открытых тикетов, 8 страниц по 100), плюс **55 тикетов целиком** с комментариями (топ по голосам + всё, что касается стен, размеров, привязки, экспорта, электрики, смет). Дополнительно: страница отзывов SourceForge (301 отзыв), карточки Cedreo и Foyr Neo в каталоге SourceForge Software (единственный доступный источник о них, кроме поисковых сниппетов). WebSearch — 8 запросов, дальше сессионный лимит поиска исчерпан; сайты sweethome3d.com, cedreo.com, foyr.com, Capterra, G2, Reddit, Wikipedia недоступны через прокси (проверено curl: код 000).

Метки: **[проверено: ссылка]** — факт виден в прочитанном тексте; **[сниппет]** — из поискового сниппета, полная страница не читалась; **[по памяти]** — знание без свежего подтверждения; **[противоречие]** — источники расходятся; **[предположение]** — моя интерпретация.

Наш продукт для сравнения: `/home/user/3d` (README.md; `src/planner/walledit.ts`, `dims.ts`, `exporters.ts`, `electricplan.ts`, `rooms.ts`, `types.ts`, `PlannerPage.tsx`).

Скачанные исходники для перепроверки: `scratchpad/sf/fr-votes.txt` (200 тикетов с голосами), `scratchpad/sf/t/<номер>.txt` (тексты тикетов), `scratchpad/sf/rv/` (отзывы, карточки Cedreo/Foyr).

---

## 0. Резюме

1. **Трекер Sweet Home 3D — 20-летний список того, что «народный» планировщик так и не сделал, и каждый второй пункт из верхушки списка — про стены и размеры.** Из 25 самых голосуемых открытых пожеланий 9 напрямую о нашей теме: рисовать стену по внутреннему/наружному размеру (#750, 8 голосов, открыт с 2015, последний комментарий 2026-02-01), показывать размеры комнат на плане (#232, 7 голосов, с 2009), «липкие» размеры, которые едут за объектом (#609, 6), экспорт «чистого» плана (#446, 7), печать всех уровней в PDF (#607, 6), электрика (#274, 5; #328, 4), привязка курсора к стенам (#407, 4), обновление комнаты при сдвиге стены (#832, 4), внутренние/наружные размеры (#647, 3) [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/search/?q=%21status%3Aclosed&sort=votes_total_i+desc].
2. **Автор (Emmanuel Puybaret) прямо отказывается от ключевых для нас вещей**, и это создаёт рынок: «Sorry I don't believe in the use of snapping to the grid or to a value» (#407, 2011-05-16); «Walls and rooms are not bound in the program at the moment… Programming this feature is costy» (#765, 2015-09-11); «I don't think there will be layers because it's a too complicated feature for a general audience program» (#133, 2009-04-05); «Sorry I won't discuss again of this subject» — о рисовании по внутренней грани (#375, 2020-11-09). Пользователь в ответ: «I would assume the ability to draw a wall based on measurements taken inside the room… to be the most fundamental feature of any floor plan software» (#375, 2020-11-09).
3. **Главная боль — стена рисуется по оси, а обмер у людей по внутренней грани.** Семь тикетов-дубликатов (#71 2008, #133 2008, #375 2010, #750 2015, #765 2015, #1059 2021, #1129/#1130 2022) и патч сообщества «alignment: left/middle/right», который так и не принят. Наш выбор «Длину считать: по оси / внутри / снаружи» (`walledit.ts:211 refLength`, `:235 setRunLengthBy`) закрывает ровно это, но у нас **нет выбора стороны при изменении толщины** — а именно это ломает комнаты у SH3D-пользователей: «What happens when you change the thickness of the wall is that the wall expands in both directions messing up your room size» (#1059, 2022-10-11).
4. **Размеры в SH3D — «плавающий текст», а не свойство чертежа**: не привязаны к стенам и мебели (#609, #819, #1009, #232), нет автопростановки, нельзя скрыть разом (#615, #847 — автор советует складывать размеры на отдельный «уровень»). У нас `dims.ts:133 followDims` уже держит размер за стеной; не хватает привязки к мебели/проёмам и «размеры всего плана одной кнопкой».
5. **Электрика и сети просят с 2009 года** (#274, #328, #421, #835, #1070, #1199) — ответ автора: «Try the Wirings plug-in», «Read this article in the blog». Наш `electricplan.ts` (группы щита, кабель, нормы) — то, чего у SH3D нет и не будет; стоит вынести это в онбординг и добавить лист «Электрический план» с легендой ГОСТ.
6. **Сметная статистика** — второй незакрытый кластер: объём/стоимость материалов (#538, 6 голосов), площадь стен за вычетом проёмов (#821, #1181), периметр комнаты для плинтуса и покраски (#736), площадь квартиры с/без стен (#144, открыт с 2009, комментарий 2026-01-15 «hello anyone help me?»). У нас периметр уже считается (`rooms.ts:216`), но наружу выводится только в панели комнаты (`PlannerPage.tsx:2334`).
7. **Печать и экспорт**: у SH3D есть PDF, печать в масштабе, SVG, OBJ — и всё равно топ просьб: «чистый план без мебели» (#446), «область печати» (#617), «рамка листа на холсте» (#833), «печать всех уровней» (#607 — закрыто только в 7.2, 2023). У нас **вообще нет PDF и масштаба** — только PNG/SVG (`exporters.ts:25–29`, `PlannerPage.tsx:3306–3307`). Для «плана как техпаспорт» это дыра.
8. **Cedreo и Foyr Neo** — облачные, платные ($79–130/мес и $49/мес), с фоторендером и библиотеками; про них ругают цену, библиотеки («missing… kitchen»), крыши, мобильную версию («crashes on iPad Pro») и исчезающую после покупки поддержку [проверено: карточки SourceForge]. У Cedreo в описании есть **«electrical plans»** и «cross-section» — единственный из пяти разобранных продуктов, где электрика заявлена как штатный лист [проверено: https://sourceforge.net/software/product/Cedreo/].

---

## 1. Sweet Home 3D: кто это

- Настольная Java-программа, GPL, с 2006 года; автор и владелец — Emmanuel Puybaret (eTeks). Последний релиз на SourceForge — **7.5 от 2024-08-21** (7.4 — 2024-05-30, 7.3 — 2024-04-04, 7.2 — 2023-09-26) [проверено: https://sourceforge.net/projects/sweethome3d/files/SweetHome3D/].
- Заявленные возможности (страница проекта): «Draw walls and rooms upon the image of an existing plan, on one or more levels; drag and drop doors, windows and furniture from a catalog; update colors, texture, size and orientation of furniture, walls, floors and ceilings; view all changes simultaneously in the 3D view; create photorealistic images and videos; import additional 3D models and export the plan at various standard formats» [проверено: https://sourceforge.net/projects/sweethome3d/].
- Рейтинг SourceForge: **4,7/5 по 301 отзыву** (259 × 5★, 20 × 4★, 6 × 3★, 4 × 2★, 12 × 1★); подрейтинги ease/features/design/support — по 4/5 [проверено: https://sourceforge.net/projects/sweethome3d/reviews/]. Единицы — за установщик с AVG-тулбаром (старый отзыв) и за «older look and somehow non-intuitive nor modern UI and shortcuts» [проверено: там же, стр. 2].
- Онлайн-версия (Sweet Home 3D JS/Online): работает в браузере с WebGL на компьютерах, планшетах и телефонах; каталог **1 600+ моделей против 10 000+** в настольной; проекты сохраняются на сервере после регистрации; диалоги правки и контекстные меню появились не сразу («The initial version missed important features like modification dialog boxes and contextual menus») [сниппет: https://www.sweethome3d.com/blog/more-modification-capabilities-in-sweet-home-3d-online/; https://www.sweethome3d.com/SweetHome3DJSOnline.jsp]. Ввод длины и угла стены с клавиатуры **недоступен в Online и Mobile** («feature not available in Online and Mobile versions») [сниппет: https://www.sweethome3d.com/users-guide/].
- Трекер: **766 открытых пожеланий**, 405 открытых багов (у багов голосование выключено — колонка Votes пустая) [проверено: https://sourceforge.net/p/sweethome3d/bugs/]. Голоса скромные (максимум 12) — SourceForge-голосование мало кто знает; зато треды длинные и с ответами автора, то есть это качественная «прямая речь».
- Экосистема плагинов, на которые автор отправляет за всем, чего нет в ядре: Advanced Edit (правка точек комнаты и стен, #375), Terrain Generator (#511), Wirings (электрика, #1070), Staircase creator (#1265, #1169), «Hide furniture» для печати (#754), HTML5 viewer (#1172) [проверено: соответствующие тикеты].

---

## 2. Трекер: что просят больше всего

### 2.1 Топ-25 открытых пожеланий по голосам

| # | Голосов | Тема | Создан | Посл. правка | Категория для нас |
|---|---|---|---|---|---|
| 593 | 12 | GPU rendering support | 2013 | 2026-02 | рендер |
| 511 | 10 | terrain editor | 2012 | 2022 | ландшафт (не наш сегмент) |
| **750** | **8** | Draw wall by known dimensions from inside or outside room, alignment and capture | 2015 | 2026-02 | **правка стен / размеры** |
| 856 | 8 | Option to pan in 3D aerial view | 2017 | 2025 | 3D |
| **232** | **7** | Show Room Dimensions | 2009 | 2023 | **размеры** |
| **446** | **7** | Export "pure" floor plan (walls, doors, windows) | 2011 | 2024 | **экспорт** |
| 618 | 7 | Simple stairs generator | 2014 | 2025 | лестницы |
| 466 | 6 | Easy method of building roofs | 2012 | 2020 | крыши |
| **538** | **6** | Calculate volume of cement / cost per walls, ceilings, floors | 2012 | 2020 | **сметы** |
| 572 | 6 | Move to git (and github) | 2013 | 2024 | — |
| **607** | **6** | Print to PDF all levels | 2013 | 2023 | **печать** |
| **609** | **6** | 'Super sticky' dimensions that attach to objects | 2013 | 2020 | **размеры** |
| 864 | 6 | Automatic roofing | 2018 | 2021 | крыши |
| **274** | **5** | electrical installation | 2009 | 2020 | **электрика** |
| **617** | **5** | Set print area | 2014 | 2017 | **печать** |
| 624 | 5 | Oculus Rift / VR Headset Integration | 2014 | 2024 | VR |
| 666 | 5 | "Visible" check-box for walls | 2014 | 2024 | 3D / слои |
| 824 | 5 | Dark/Night mode | 2017 | 2022 | UI |
| **835** | **5** | Energy networks (газ, электрика, вода, RJ45…) | 2017 | 2020 | **инженерка** |
| 972 | 5 | Make levels groupable | 2020 | 2021 | слои |
| **328** | **4** | Electrical Component in 2D design view | 2010 | 2026-08 | **электрика** |
| **407** | **4** | Cursor Snap! Wall Snap! | 2011 | 2024 | **привязка** |
| 565 | 4 | Screaming for Organization! (каталог по папкам) | 2013 | 2014 | каталог |
| 716 | 4 | Creating 2D cuts and views | 2015 | 2025 | чертежи |
| **832** | **4** | Automatic update of room when a wall was moved | 2017 | 2020 | **правка стен** |

[проверено: https://sourceforge.net/p/sweethome3d/feature-requests/search/?q=%21status%3Aclosed&sort=votes_total_i+desc&limit=100 — полный список 200 тикетов сохранён в `scratchpad/sf/fr-votes.txt`]

Дальше по списку (3–2 голоса) — тот же состав: #647 Show interior/exterior dimensions (3), #736 perimeter of rooms (3), #819 Automatic dimension texts (3), #919 Walls clockwise/counterclockwise + better snap (3), #1009 Parametric modeling and geometric constraints (3), #1130 Creating walls using left or right edge — solution (3), #1070 канализация и электросхема (3), #421 service network plugin (3), #508 Moving all objects (3), #615 Show/Hide Dimensions (3), #592 Wall Magnet (2), #637 magnetism of walls (2), #848 Detach walls (2), #1059 Demanding adjustment of wall thicknesses (2), #1069 List of Walls (2), #1085 Guide lines (2), #1079 export DWG/IFC (2), #1181 Surface area sizes (2), #1199 Plumbing (2), #821 Statistic of used surfaces (2), #526 scaled printing in USA (2), #754 Hide ALL furniture on print (2), #847 Hide text and dimensions (2).

Свежие (2025–2026, голосов ещё нет): #1277 Lock objects to prevent accidental selection or movement (2026-04), #1276 Object explorer with folder structure (2026-04), #1278 Plan background image opacity (2026-06), #1268 Wall width does not match entered width when walls are joined (2026-02), #1265 Lock dimensions of items (2025-12), #1260 No way to adjust UI scaling (2025-07), #1259 Layer tabs made easy (2025-06) [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/].

### 2.2 Кластер «стена по грани, а не по оси» (#71, #133, #375, #750, #765, #1052, #1059, #1129, #1130, #720, #919)

Что просят и как это звучит:
- #750 (Roman Smekal, 2015-11-16): «You use only middle (centre), but if you have and know the dimensions from inside room, and also informations about width of the wall will be perfect if I can set generally that I draw walls from inside dimensions and you add automatically the width or from outside… I find that same notes and request had also other persons, but it is long time ago… Why this points isn't important for you?» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/750/].
- Ответ автора (2015-11-16): «What makes you think it's not important for me? It's more like nobody proposed a better solution to draw the walls of a home with multiple rooms that are not always rectangle. Note also that walls in real houses have rarely the same thickness everywhere, and that this choice comes from the idea that you'll draw walls upon a blueprint you imported, in which case drawing from the middle isn't a problem… if you want to draw the walls of ONE room from its inner dimension, then draw it with the room creation tool, then choose the wall creation tool, double-click in the room and here are the walls you want!» [проверено: там же].
- Тот же тред, Florian (2016-01-31): «I drew a room (which I measured from inside) and created walls by double-clicking… Then I changed the wall thickness to 80cm (old stone building). This made the walls come 40cms into the room which results in a much smaller room… Otherwise the measurements and the calculated square footage do not match the original room anymore» [проверено].
- #1059 (Eduard Rybar, 2021-12-01): «when I set the individual wall thickness, the wall adjusted in this way is moved by its thickness center to the corner of the surface. This shift is then very difficult to adjust… I have measured the internal dimensions of the area as well as the individual wall thicknesses. The walls often have different thicknesses, often with a difference of 20 cm… (the right behavior… is by my opinion in this online tool: floorplancreator.net)». Комментарий (2022-10-11): «add a drag option to the wall so you expand or reduce the wall thickness yourself with the mouse; when you edit the wall and change the thickness you can select in which direction it should expand or reduce (top/both/bottom) or (left/both/right)» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1059/].
- #1130 (shoulders, 2022-10-22) — готовое решение с макетами: «Currently when you draw around a room you have to: start the wall 1/2 the thickness away from the line on the blueprint because the wall draws from the middle; make sure you go 1/2 the width more than the end of the wall… This wall drawing tool would now have the modes (Left Edge/Normal/Right Edge)». Ronny Buchmann (2023-02-19): «I created a draft version already five years ago… Alignment of the wall can be changed between left, middle (default), right. When changed to middle, files stay compatible with unpatched version. Please give this patch a try» — и список из 7 тикетов, которые этот патч закрыл бы [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1130/].
- #765 (Jan M. Simons, 2015-09-10): «Create a room and remember its size; create the walls by double click; increase the size of the walls by a significant amount; delete the room; create a new room inside of the walls; note the difference in the size of the room». Автор: «Walls and rooms are not bound in the program at the moment… Programming this feature is costy, and I always fear that adding too much automatic modifications remove some abilities for the user to customize his plan». Пользователь (block 4): «I have the plan of a flat on paper and want to recreate it digitally. My method now would be: 1) create room (it's possible to enter the exact lengths of the sides) 2) create walls around the room and change to right size 3) create next room…» Автор: «If you have a "flat on paper", the best way is to start is to import it as a background image and draw walls upon it». Tylla (2016-12-31): «implementing one extra property for the walls: alignment… left, center, right… When creating walls with double-click, the alignment should be set to the inner side of the walls… This solution can be seen in some other programs as well (e.g. FreeCAD)» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/765/].
- #375 (2010), комментарий Michael von Glasow (2020-11-09): «Without that, you can't even create a scale model of the building other than by manually editing the XML file». Автор (2020-11-09): «Sorry I won't discuss again of this subject to which I answered in many other places». Через день пользователь нашёл плагин Advanced Edit: «alleviates most issues — still not a 100% solution… I guess that would make it a candidate for the FAQ: briefly state the reason why certain editing features are not (and maybe never will be) found in Sweet Home 3D, and provide a pointer to the plugin». Автор: «You're right, I should add an entry in the FAQ about this» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/375/].
- #133 (2008): «outside walls: when you know what is size of the apartment inside… I mean to set size to 8,5 x 8 not 8,5 + 0,15 + 0,1 x 8 + 0,15 + 0,1». Комментарий: «Finally i set the wall thickness to 0.1cm. So you can forget the thickness, and use the real measurement» — обходной путь «стена нулевой толщины» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/133/].
- #1268 (2026-02-01): «Wall width when joined is wrong. Half of the wall thickness is added to its width. Expected: Wall width should be the same as entered in wall properties» — «This is not a bug, move it to feature request» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1268/]. Это ровно эффект «длина по оси ≠ длина грани на полтолщины поперечной стены», который у нас объяснён в панели («у стены 400 по оси с углами по 10 см: внутри 390, снаружи 410», README).

**Вывод для нас.** Все три составляющих боли у нас закрыты по-разному: (а) ввод длины по грани — есть (`walledit.ts:235 setRunLengthBy`, README «Длину считать»); (б) комната и стены связаны, комната пересчитывается сама (`rooms.ts`, замкнутые контуры → комнаты); (в) **изменение толщины** — `setRunThickness` (`walledit.ts:465–470`) меняет только `thickness`, оси `a`/`b` не трогает, то есть стена утолщается симметрично от оси, и комната «в чистоте» худеет на полразницы с каждой стороны — ровно поведение SH3D из #1059/#765; в панели свойств это `<select>` толщины без выбора стороны (`PlannerPage.tsx:2157–2158`). Пункт (в) — прямой кандидат в бэклог (§7, п. 3).

### 2.3 Кластер «размеры» (#232, #609, #647, #819, #1009, #615, #847, #720, #820, #1265)

- #232 (2009): «after drawing my home I noticed that my measurements is somewhere out by a few centimetres, but now I have to go click on each room corner to spot the length of a section. It gets harder when you need to figure out what corner to click… Then also I sometimes accidentally move the corner and have to undo». Автор темы, вдогонку: «the measurement does not lock to the sides of the walls (it does not move when the room move or is resized)». Stijn (2013-07-10): «display and print the dimensions of a room (length and width of the walls, windows, etc.), instead of the area. This would make calculating the materials needed easier, as well as aid in explaining to contractors». KitchM (2023-01-16): «Oh yeah. Surprised its not there» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/232/].
- #647 (2014): «If I draw walls, it isn't clear if the dimensions shown are interior or exterior. If I want to resize a wall, I can click and drag it, but I don't get feedback on the walls that are attached to it and growing… when I drag the corner, by definition two walls change length, but the tooltip only reports one wall, and it isn't clear which wall it is reporting». Chris (2014-07-07): «Show ALL the changing dimensions if possible… This would great help the long-running issue about editing rooms to a particular interior size — see all the forum discussions» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/647/].
- #609 (2013): «If dimensions would stay attached to whatever edge, point, object, or centerline that I originally snapped them to. Thus if I put a chair 2 feet from the wall, and later drag it to 3 feet from the wall, the dimension should both come along for the ride and also (as I'm dragging) tell me if I'm in the right place» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/609/].
- #819 (2017): «automatic dimension text could measure out all walls, for inside and outside dimensions. Additional even distance to corners for windows doors and light switches (all wall objects)… The measuring tool now is imprecise and very time costly… because it is not attached to wall corners and objects. (In the present form it was almost useless for me.)» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/819/].
- #1009 (2020, из CAD): «I'd first click one inner side of the wall and then the other. The dimensions would snap to the walls and create a restriction. Which would mean that if I double click the dimension to edit it, it would adjust the distance between the walls… if you have one dimension manually adjusted (by typing in the value), it will stay that way unless you unlock it» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1009/]. Это буквально наш «щелчок по подписи стороны комнаты → ввести 234 → выбрать, какую стену двигать» (README) плюс замок стены (`types.ts:14`).
- #615/#847: скрыть все размеры разом — нельзя; совет автора: «add them to a separated level at the same elevation… and make the level unviewable / viewable» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/615/, /847/]. У нас слой `dims` в меню «Вид» (`PlannerPage.tsx:74 DEFAULT_LAYERS`, `:3209–3222`).
- #720 (2015): «After you create a room, it would be nice if you could select a line segment and directly input its length… Then you could build the walls and they'd be the correct inside length» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/720/].
- #820 (2017): «if a wall position is changed, all windows doors and furniture has to be replaced again» — просьба привязать мебель к стене/углу [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/820/]. У нас проёмы хранятся как `t` вдоль стены (`types.ts:22`), то есть переезжают со стеной; мебель — нет.
- #1265 (2025-12-15): «I cannot tell you the number of times I've drawn a wall, or a segment of a wall, window, or door… only to accidentally bump it and have the dimensions change!» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1265/].
- Отзыв на SourceForge (стр. 2, № 24): «The issue of this project is that it seems to forget the essential dimensions to be PERMANENTLY overlayed in its 2D plan diagram in order to be useful for more than a simply on screen design game… Any architecture related plan should have visible main dimensions on it rather than approximate them from a measurement scale!» [проверено: https://sourceforge.net/projects/sweethome3d/reviews/?page=2].

### 2.4 Кластер «привязка и точность» (#407, #592, #637, #1085, #833, #998, #919, #596, #1186)

- #407 (2011): просьба о шаге привязки под размер блока (200 мм). Автор (2011-05-16): «Sorry I don't believe in the use of snapping to the grid or to a value. Have a look to real plans and you'll see that walls have almost never round values. If you want to adjust precisely the position… please enter values with the keyboard after pressing the <enter> key». Ответ turnkit (2015-08-15): «Please please please reconsider. This issue is not just about snapping to a grid but snapping wall ends to each other. Perhaps a quarter to half my time using sh3d is spent trying to get walls to line up precisely with each other… The same is true with the measuring tool». Mikhail: «In a blender Snap perfectly arranged… This will speed up the program from 3 to factor of 5 for me» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/407/].
- #592 (2013): «the walls keep becoming unleveled because your fine motor control/mouse don't help you». OK Hoff: «I have not found a way to make sure a wall starts at x0 y0 (it is always a couple of cm off)… For a wooden house here, you rely on 60cm between studs» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/592/].
- #1085 (2022): направляющие из линеек, как в GIMP/Inkscape; комментарий Kaa (2026-02-01): «I come from Sketchup and what I find difficult in SH3D is its snapping does not work as expected. I expected i could snap to wall borders, but it does not (I have the option enabled). It snaps to something sometimes but I can't find it snap to what i move it near to» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1085/].
- #833 (2017): магнетизм меняет размер двери при постановке («the Depth is enlarged from standard 0,68m to 1,587m»); просьбы: настраиваемый шаг сетки, **границы листа для печати на холсте**, **строка состояния с координатами курсора и размерами выделенного** [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/833/].
- #1186 (2023, геймдев-разработчик): горячие клавиши режимов {1}=Cursor {2}=Hand {3}=Wall {4}=Room, магнетизм на {=}; «Show the exact X & Y coordinates when moving area points»; «Alt+Click on an area point removes it, Ctrl + Click on an area line adds a point» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1186/]. У нас однобуквенные инструменты уже есть (README: W, D, N, M).

### 2.5 Кластер «правка стен» (#832, #848, #508, #666, #1069, #1277)

- #832 (2017): «When the layout is changed by moving a wall, the old room need to be deleted and created again» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/832/].
- #848 (2017): «At present when we modify a wall, it drags along with it another wall… A "Detach walls" will allow users to extend or shift an existing wall with ease without having to split or delete it first». Автор: «I'm not sure it's worth introducing this new selection mode just to detach a wall. The workaround… cut and paste the wall you want to detach, then select with the Shift key… and join them again». Hannah (2023-05-08): «couldn't you have a feature where you select a joint and click "detach"?» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/848/]. У нас: Shift при растяжке за кружок — «свободно» (README, раздел о стенах).
- #666 (2014, 5 голосов): галочка «Visible» у стен, чтобы смотреть 3D с «до/после» стены. Автор (2015-11-16): «You could use levels viewability added in version 5. By the way, once you would have made walls and rooms invisible, how would you make them visible again? ;-)» — Bryce (2024-09-03): «A usual solution to that is a single control: unhide all objects» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/666/].
- #1277 (2026-04-22): замок на объекты «similar to what is available in tools like Photoshop… locked objects cannot be selected, moved, modified… especially useful for rooms and walls, background/reference objects, finalized layout elements» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1277/]. В SH3D есть только глобальный «Lock base plan» (с версии 1.8, 2009: «lock the base plan (meaning walls, rooms, dimensions, free texts, doors and windows), to improve the layout of furniture» — #133) [проверено].
- #1069 (2022): «List of walls (like List of furniture) giving information on the walls: Level, Length, thickness, Angle, Starting point… It will allow to check quickly if walls are well aligned, superposed, straight» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1069/].

### 2.6 Кластер «экспорт, печать, масштаб» (#446, #607, #617, #754, #526, #1079, #833)

- #446 (2011, 7 голосов): «export just the "pure" floor plan with no actual furniture — just walls, doors, and windows (and possibly some other "special" elements like light switches, sockets etc.)… especially with an export format like DXF». Herman (2015): «the current workaround of toggling the visibility of the unwanted objects before printing is cumbersome» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/446/].
- #754 (2015): «I want to be able to submit my plans to a builder, and to "clean" up the floor plan I'd like to hide all furniture when I print… Not Doors or windows». Автор (2017): «cut / paste it in a new level at same elevation that you'll make not viewable». Zoltán (2020): написал плагин «Hide furniture» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/754/].
- #607 (2013): печать всех уровней в PDF; закрыто по существу в 7.2: «The page setup dialog box of Sweet Home 3D 7.2 lets you choose which levels you want to print» (2023-09-24) [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/607/].
- #617 (2014): «Printing is either a certain scale that will chop up my layout into a number of pages, or with the best fit it squeezes everything down… A "Scale to structure bounds" option would be amazing. Short of that a "Set print area"» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/617/].
- #526 scaled printing in USA (1/4" = 1'), #300 «Hard to print in A3», #1079 «export DWG, IFC… pour utiliser dans Revit», #1054 IGES-импорт [проверено: список].
- Баги про печать держатся годами: #211 «Can't print wide drawings to PDF», #409 «Segfault on print preview and export to pdf», #435 «Order of numbers in vertical dimension labels is inverted on paper printout» [проверено: https://sourceforge.net/p/sweethome3d/bugs/].

### 2.7 Кластер «электрика и сети» (#274, #328, #421, #835, #1070, #1199, #785, #982)

- #274 (2009): «My wish: electrical installation». Jan (2014-02-19): «In order to draw the electrical installation I exported an svg file from SH3d and imported into Dia to add the symbols… It would already be very practical to be able to drop electrical symbols (library) on the drawing» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/274/].
- #328 (2010, обновлён 2026-08-10): «add (like walls) basic electrical component on the wall (can specify the height of placement) and light on free position… make relationship between electrical components (no rendered in the 3d view) in order to make an electrical 2d plan» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/328/].
- #421 (2011): «A plug-in to manage all networks (electricity, computers, TV, telephone, water, drain, heating…). It will allow to define the outlets but also the cabling (and compute lengths as well)». Комментарий: «allow to add just outlets of different pre-defined categories… generate floor plans with the corresponding standard symbols in the right places»; выяснилось, что planIcon не умеет SVG [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/421/].
- #835 (2017, 5 голосов): план только стен и сетей — «gaz, électricité, eau froide, eau chaude, écoulements, RJ45, musique, domotique, TV avec la possibilité de créer une légende éditable… afin de créer un vrai tableau électrique» — то есть легенда и **настоящий щит** [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/835/].
- #1070 (2022): трубы «ne peut pas traverser un mur», кабельные трассы; ответ: «Essayez le plug-in Wirings» [проверено]. #1199 (2024): «design plumbing and electrical fixtures… with the same easy and quick approach»; автор: «Read this article in the blog» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1199/].

Ни в одном ответе автора нет намёка на то, чтобы электрику сделать частью ядра. Наш `electricplan.ts` (488 строк: группы, автоматы, кабель по сечениям, трассы, нормы ПУЭ/СП, ведомость CSV — README «Электрика: проект как у инженера») — единственный в этой пятёрке, кто это делает по правилам, а не символами.

### 2.8 Кластер «сметы и статистика» (#538, #821, #736, #144, #1181)

- #538 (2012, 6): «calculate the total volume of the walls, floors and ceilings so that a user can estimate the amount of cement needed and the cost per square foot… enter a dollar value per square foot… for each» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/538/].
- #821 (2017): «Surface of the walls, separated by their thickness (minus all holes). Inside surface of all rooms. List of all objects, specially fix/wall objects like windows, doors, switches etc» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/821/].
- #736 (2015): «perimeter of a selected room? Very useful to calc areas of walls (for instance for painting estimate)»; «this lacks for my need of plinths for my parquet floor» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/736/].
- #144 (2009): «calculates the square meter of my house (exclusive of the walls)»; автор в 2009 предлагает написать плагин; Jack (2015): семь пунктов статистики — «total floor area, with and without walls; length of external walls; area of external walls less windows, doors…; length of internal walls…; dimensions and area of smallest enclosing rectangle»; alida (2026-01-15): «hello anyone help me?» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/144/].
- #1181 (2023): площади выделенных поверхностей в 3D «for ordering material, such as wallpaper, floor boards, ceiling tiles, paint»; автор (2024-04-23): «don't hope this feature in Sweet Home 3D itself in a close future» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/1181/].

### 2.9 Остальное из топа (кратко)

- **GPU-рендер** (#593, 12 голосов) — фоторендер SunFlow на CPU; отзыв: «At 4k it took ten hours» [проверено: reviews]. PK (2013): предлагал экспорт в RIB для внешних рендеров. Для нас неактуально: 3D в браузере без фоторендера — это осознанный выбор.
- **Панорамирование в 3D сверху** (#856, 8): «I don't like having to go to Virtual Visit mode just to be able to pan» [проверено]. У нас `View3D.tsx:211 OrbitControls` — pan есть по умолчанию (правая кнопка / два пальца) [предположение: проверить подсказку в UI].
- **Уровни как слои** (#972, 5): «I use levels to categorize… eventually finding up to 80 levels per project»; «I need to use other tools for network planning, electrics, etc.» [проверено: https://sourceforge.net/p/sweethome3d/feature-requests/972/].
- **Организация каталога** (#565, 4; #630, 3; #1276) — папки/подпапки для мебели [проверено].
- **Тёмная тема** (#824, 5): «The white background color is a bit racking on some folks' eyes» [проверено].
- **Разрезы и фасады** (#716, 4; #450, 3; #773) — 2D cuts and views [проверено].
- **Полустены, стены с отметкой, наклон снизу** (#846, 3; отзыв на SF стр. 1 № 14: «create walls with starting elevations, much like furniture… a buildout above cabinets») [проверено].

---

## 3. Как устроено взаимодействие в Sweet Home 3D (по категориям)

### 3.1 Рисование стен
- Инструмент «Create walls»: щелчок в начале, щелчок/двойной щелчок в конце; каждый следующий щелчок — конец текущей и начало следующей стены; двойной щелчок или Esc — закончить [сниппет: https://sbcode.net/sh3d/drawing-walls/; https://www.sweethome3d.com/users-guide/].
- Во время рисования у курсора подсказка с длиной, углом и толщиной; толщина показывается «to help you compute walls length» с версии 2.0 [проверено: #71/#133, ответ автора 2009-06-06; сниппет roomfit.app].
- **Ввод с клавиатуры**: нажать Enter во время рисования → поля длины и угла (в настольной версии; в Online/Mobile недоступно) [сниппет: users-guide].
- Магнетизм округляет угол к кратным 15° и длину к целым см [по памяти]; временно отключается удержанием Alt (Windows/Linux) / Cmd (macOS) [по памяти]. Комментарий в #1085: «I expected i could snap to wall borders, but it does not (I have the option enabled)» — к граням стен привязки нет [проверено].
- Стена всегда рисуется **по оси**; альтернативного режима нет и не планируется (§2.2). «Square/box walls» (#163, прямоугольником) — открыт с 2009.
- Стены вокруг готовой комнаты — двойной щелчок инструментом стен внутри комнаты [проверено: #750, #1130].

### 3.2 Правка стен и комнат
- Одинарный щелчок — выделить; двойной — диалог «Modify walls»: координаты начала/конца X/Y, длина (по оси), угол, толщина, высота в начале и в конце (наклонные стены), цвет/текстура каждой стороны, плинтусы, «мостик» для стрелки [по памяти, состав диалога не перепроверен]; в сниппете: «double click a wall to get its modifiable properties, such as colour, texture, thickness, start and end heights» [сниппет: sbcode.net].
- Растяжка: тащить конец стены; примыкающие стены двигаются за концом только там, где они соединены (join). Обратная связь при растяжке — «the tooltip only reports one wall» (#647).
- Контекстное меню: Split wall, Join walls, Reverse wall direction [проверено по упоминаниям в #848 («The "Join walls" is a really handy feature», «I also use Split wall»)]. Detach — нет (#848).
- Комнаты — отдельные объекты, рисуются точками или двойным щелчком внутри замкнутых стен [по памяти]; со стенами не связаны (#765, #832); в v5 добавлены «Add point to room» / «Delete point from room» и «Paste style» как обход [проверено: #765, автор].
- Толщина меняется симметрично от оси (#1059, #1129, #765).
- Замок: «Lock base plan» на всё разом (v1.8) [проверено: #133]; по объекту — нет (#1277, #1265).

### 3.3 Размеры и единицы
- Единицы: см, мм, м, дюймы, футы/дюймы в настройках [по памяти]; #526 — масштаб печати в имперских не настраивается.
- Площадь комнаты — текст в центре комнаты (#232). Размерные линии — ручной инструмент «Create dimensions», не привязанные ни к чему (#609, #819, #1009); показать/скрыть разом — нельзя (#615, #847); тикет #473 «allow dimensions to be edited» закрыт 2023-09-24 [проверено: список] — вероятно, в 7.2 размерным линиям добавили правку [предположение].
- Внутренний/наружный размер — не различаются (#647).

### 3.4 Двери, окна, проёмы
- Это мебель из каталога («Doors and windows» — одна категория, #565); перетаскиваются на стену, магнетизм вписывает их в стену и **может изменить глубину двери** (#833: 0,68 → 1,587 м) [проверено]. Толщина проёма подгоняется под стену автоматически [по памяти]. При сдвиге стены двери/окна не едут за ней (#820) [проверено].
- Открывание/закрывание дверей (#445) закрыт 2021 [проверено: список].

### 3.5 Каталог мебели и техники
- 10 000+ моделей в настольной, 1 600+ в Online [сниппет]; импорт OBJ/DAE/3DS/KMZ [по памяти]; папки/подпапки в каталоге — нет (#565, #630, #1276); группировка мебели есть с 3.5 (#508: «the function 'group' unfortunately works only furniture»), «Select all at all levels» с 4.4 [проверено].
- Отзывы: «somehow not so modern 3d models» [проверено: reviews стр. 1]; «I've had to do some work arounds for furniture that wasn't available» [проверено].

### 3.6 Отделка
- Цвет/текстура на каждую сторону стены, пол/потолок комнаты, плинтусы (с 5.x) [по памяти]; открытые просьбы: разные текстуры по высоте одной стены (#1001), карнизы автоматом (#1162), плинтус на 3-й/4-й стороне (#968) [проверено: список].

### 3.7 ИИ-функции
- Нет. Единственное «автоматическое» — #167 «Automatic organizing of furniture» (2009, 0 голосов) [проверено: список]. Распознавания планов нет: фон — картинка через мастер «Import background image», масштаб задаётся отрезком известной длины [по памяти; см. `docs/plan-from-image.md:15,71`].

### 3.8 Электрика / инженерка / сметы
- Нет в ядре (§2.7, §2.8). В каталоге есть декоративные розетки/выключатели («electric service outlets already present» — #421) [проверено]. Плагин Wirings [проверено: #1070].

### 3.9 3D / рендер / VR / AR
- 3D-вид синхронно с 2D (aerial + virtual visitor), фоторендер SunFlow (CPU, «10 hours at 4k» — отзыв), видео; GPU — #593; VR — #624 (5), #1088 (WebXR в online, 1 голос) [проверено: список]; AR — нет [по памяти].

### 3.10 Экспорт / печать / масштаб / DXF / PDF
- Есть: печать и PDF (с 7.2 — выбор уровней), масштаб при печати, экспорт SVG плана, OBJ сцены, .sh3d (zip с XML) [проверено: тикеты #607, #532, #265, #375 «manually editing the XML file»]. Нет: DXF/DWG/IFC (#446, #376, #1079), область печати (#617), «чистый план» (#446, #754), рамка листа на холсте (#833).

### 3.11 Облако / совместная работа / версии
- Настольная — файл на диске, никакого облака; Online — проекты на сервере после регистрации [сниппет]; совместной работы, истории версий и ссылок «только просмотр» нет (#1168 «View-only online tool», 2023, 0 голосов; #1073 «Online: rename project») [проверено: список]. HTML5 viewer — плагин для выкладки на сайт (#1172).

### 3.12 Мобильные приложения
- Нет нативных; Online-версия «на планшетах и смартфонах» [сниппет]; #603 «iPhone/iPad support» (2013), #1071 «Future version of android and ios» (2022, 0 голосов), #1263 «Importer modèles 3D Android» (2025) [проверено: список].

### 3.13 Онбординг / обучение / шаблоны
- Пустой холст + панели «каталог / список мебели / план / 3D»; обучение — users-guide, видео и форум; шаблонов нет (в тикетах «template» только про крыши) [проверено: поиск по трекеру]. Отзывы: «It takes some getting used to, if… you have no CAD experience»; «it took me one full day from zero knowledge to having my tiny apartment of 41 square meters reproduced with its real measures» [проверено: reviews].
- Автор отвечает на «где что» отсылкой к встроенной справке: «Many of these features are already there. Please read the included help to discover them» (#573) [проверено].

### 3.14 Ограничения free-версии / цена
- Настольная — полностью бесплатна и открыта (GPL); платные сборки в Mac App Store / Microsoft Store — та же функциональность за символическую цену [по памяти]. Online — бесплатно с регистрацией [по памяти, лимиты не проверены]. Отзыв: «Had to make an account just to say: "I LOVE THE LICENSE AGREEMENT!"» [проверено: reviews].

### 3.15 Сильные стороны Sweet Home 3D (что нам стоит уважать)
1. **Бесплатно, открыто, 20 лет стабильно** — 4,7/5 на 301 отзыв; люди возвращаются через 10 лет («learning my way around in class back in MIDDLE SCHOOL… coming back to it 10 YEARS LATER») [проверено].
2. **Всё честно с геометрией**: ввод длины и угла с клавиатуры по Enter; двойной щелчок → полный диалог свойств с координатами; форматы .sh3d — zip с читаемым XML.
3. **2D и 3D одновременно** в одном окне; фоторендер и видео из коробки.
4. **Уровни (этажи)**, каждый со своей видимостью, — люди используют их как слои (#972: до 80 уровней).
5. **Экосистема плагинов и доброжелательный форум** — «everyone on the forum was incredibly helpful» [проверено: reviews].
6. **Фон-картинка под чертёж** как основной сценарий обмера квартиры — то, на что автор ссылается как на «правильный путь» (#765). Мы идём тем же путём, но с распознаванием.

---

## 4. Cedreo — коротко, как ориентир «профи за деньги»

- Позиционирование: «The only 3D home design software to create conceptual designs in just 2 hours»; для «home builders, contractors, remodelers, real estate agents, and interior designers»; создаёт «2D and 3D floor plans, site plans, electrical plans, and photorealistic 3D renderings» [проверено: https://sourceforge.net/software/product/Cedreo/]. Компания основана в 2005 (Франция/США) [проверено: карточка].
- Цена: Pro $79/мес, Enterprise $129/пользователь/мес, есть бесплатный план «with limited features» [сниппет: https://justcreative.com/cedreo-review/]; карточка SourceForge — «Starting Price: $130.9», «Free Version Available» [проверено] [противоречие: вероятно, $130,9 — помесячная оплата Pro, $79 — годовая; не подтверждено]. «Cedreo Pricing isn't cheap compared to most home design or floor planning software, partly because it's aimed at the professional market» [сниппет: justcreative].
- Взаимодействие: облачный редактор в браузере; стены — щелчками, длина правится числом в поле у стены; 2D-план с автоматическими размерами и площадями комнат [по памяти, не перепроверено]. «Cross-section» — разрез одним щелчком с живым предпросмотром: «allows you to create elevations in one click… create a cut directly on your plan and preview the results live» [сниппет: justcreative]. Электрический план как отдельный лист [проверено: описание в карточке]. Рендер в облаке за минуты [по памяти].
- ИИ: маркетинг говорит «AI-driven design boosts efficiency» [сниппет: geniusfirms/itqlick]; конкретики (что именно делает ИИ) в доступных источниках нет — [не подтверждено].
- Что хвалят: «Easy, quite fast, rendering quality»; «zero learning curve»; «customer support is excellent» [проверено: карточка; сниппет]. Рейтинг в карточке 5,0 по 2 отзывам — статистически пусто [проверено].
- Что ругают: «Missing features (deck, pool…) and product libraries (kitchen…)»; «Quite long to launch and some complicated tricks with roofs»; features 3,5/5 и design 3,5/5 при ease 4,5/5 [проверено: карточка].
- Мобильных приложений нет; в карточке «Platforms: Windows, Mac, Linux, Cloud, iPhone, iPad, Android, Chromebook» — это шаблон каталога про браузер, а не нативные приложения [предположение].

## 5. Foyr Neo — коротко

- Позиционирование: «Lightning fast interior design software built with YOU in mind… drag-and-drop furniture from thousands of pre-modeled products, real-time 3D editing capabilities, photorealistic 4K rendering, and the ability to upload custom 3D models» [проверено: https://sourceforge.net/software/product/Foyr-Neo/]. Компания 2014, США/Индия [проверено: карточка].
- Цена: «$49 per month», есть бесплатный триал [проверено: карточка]; в сниппетах — «starts at $29/month… annual plan option at $49/month» [сниппет: trustradius/saasworthy] [противоречие]. Рейтинги: SourceForge 3,8/5 по 4 отзывам (ease 4,8, support 3,8) [проверено]; «4.0/5 rating from 69 reviews» [сниппет, источник не назван].
- Взаимодействие: облачный, «drag-and-drop with a large 3D furniture catalogue rather than drafting commands»; рендер в облаке «4K outputs without a GPU workstation» [сниппет]. План рисуется в 2D-режиме комнатами/стенами, правка в реальном времени в 3D [по памяти, не перепроверено]. Шаблоны интерьеров («pre-design templates»), загрузка своих моделей, коллаборация [проверено: отзыв Ashley J., карточка].
- ИИ: в 2024–2025 Foyr продвигал «Neo AI»/AI-рендер по фото [по памяти, не подтверждено доступными источниками].
- Что хвалят: «incredibly easy to use», «Ultra Fast 4K Rendering», «Amazing 24/7 chat support», «Everything an interior designer needs is packed into one platform» [проверено: карточка/отзывы].
- Что ругают: «Poor mobile solution, terrible customer service»; «crashes on iPad Pro»; «Resource library is lacking in content and texture»; «Too expensive for its lack of functionality compared to Home Design 3D»; «Pre-purchase support disappeared post-purchase»; требует стабильного интернета; подписка вместо разовой покупки [проверено: https://sourceforge.net/software/product/Foyr-Neo/reviews/, отзыв William M. 2022-06-22].

**Что общего у «профи за деньги»:** электрический план как лист (Cedreo), разрез одним щелчком (Cedreo), облачный рендер без GPU (оба), 24/7 чат (оба заявляют, оба ругают за поддержку), библиотеки — вечная претензия, мобильная версия — слабое место (Foyr). Ни у одного из них в доступных источниках нет распознавания плана по фото и проверок эргономики/норм.

---

## 6. Матрица по категориям

| Категория | Sweet Home 3D (desktop 7.5) | Cedreo | Foyr Neo | Мы (`/home/user/3d`) |
|---|---|---|---|---|
| Рисование стен | По точкам, только по оси; Enter → длина+угол (не в Online); магнит 15°/1 см; стены вокруг комнаты двойным щелчком | Щелчками, длина числом [по памяти] | Комнаты/стены drag-and-drop [по памяти] | По точкам и прямоугольником; привязка к концам/осям/Т-стыкам/сетке/0-45-90; длина цифрами во время рисования (`PlannerCanvas.tsx:342`) |
| Правка стен/комнат | Тянуть конец; Split/Join/Reverse; толщина симметрично; комната не следует за стеной (#832); Detach нет (#848) | Панель свойств стены [по памяти] | В 3D в реальном времени [по памяти] | Прямая целиком, тянуть поперёк, Alt — участок, замок стены, комнаты пересчитываются (`walledit.ts`) |
| Размеры и единицы | Площадь в центре комнаты; размерные линии ручные, не привязанные (#609); внутр./наруж. не различаются (#647) | Авторазмеры на 2D-плане [по памяти] | Размеры на плане [по памяти] | Размер каждой стороны комнаты в чистоте; размер числом со щелчка; «по оси/внутри/снаружи»; размеры привязаны к стенам (`dims.ts:133`) |
| Двери/окна/проёмы | Мебель из каталога, магнит может менять глубину (#833); не едут за стеной (#820) | Штатные объекты стены [по памяти] | Штатные [по памяти] | Прилипают к стене, `t` вдоль стены (`types.ts:22`), сектор открывания |
| Каталог | 10 000+ (Online 1 600+), импорт OBJ/DAE/3DS/KMZ; без папок (#565) | Библиотеки — «missing kitchen» (отзыв) | «thousands», загрузка своих; «library lacking» (отзыв) | ~60 предметов + Poly Haven + товар по ссылке (README) |
| Отделка | Цвет/текстура по сторонам, плинтусы | Материалы для рендера | Материалы для рендера | Пол по комнате; отделка стен — минимальна [предположение] |
| ИИ | Нет | «AI-driven» без конкретики | «Neo AI» [по памяти] | Распознавание БТИ по фото с проверкой по подписям; расстановка с проверкой геометрией (`planai.ts`, `furnish.ts`) |
| Электрика/инженерка/сметы | Нет (плагин Wirings); просят с 2009 | «Electrical plans» как лист (описание) | Bill of Materials (список функций карточки) | Группы щита, кабель, автоматы, нормы, ведомость CSV (`electricplan.ts`) |
| 3D/рендер/VR/AR | 2D+3D синхронно, SunFlow-рендер (CPU), видео; VR/AR нет | Облачный фоторендер, разрез | Облачный 4K, virtual tour | Three.js в браузере, WebXR AR (Android), USDZ (iOS) |
| Экспорт/печать/DXF/PDF | PDF, печать в масштабе, SVG, OBJ; DXF нет; «чистый план» и область печати — открытые | PDF-комплект [по памяти] | Экспорт рендеров [по памяти] | **Только PNG/SVG/JSON/CSV** (`exporters.ts`) |
| Облако/совместная работа/версии | Файл на диске; Online — на сервере; шаринга нет | Облако, проекты в аккаунте | Облако, «collaboration tools» | localStorage + JSON + ссылка с планом внутри (README) |
| Мобильные | Нет (Online в браузере) | Нет | Веб на iPad — «crashes» | Мобильная вёрстка, Telegram Mini App |
| Онбординг/шаблоны | Пустой холст, справка, форум | «zero learning curve», онбординг команды | Шаблоны интерьеров, чат 24/7 | Стартовый экран «С чего начнём?», 3 шаблона квартир (`templates.ts:59–180`), подложка по шагам |
| Free / цена | Всё бесплатно (GPL) | Free с ограничениями; $79–130/мес | Триал; $29–49/мес | Бесплатно; ИИ — копейки по прайсу routerai (README «Деньги») |

---

## 7. Что из этого стоит взять нам и почему

Оценка пользы — для нашего сегмента (квартира, план БТИ, разговор с прорабом/электриком); цена — в рабочих днях одного разработчика, с запасом на тесты.

| № | Предложение | Откуда взято (доказательство спроса) | У нас сейчас | Польза | Цена |
|---|---|---|---|---|---|
| 1 | **Лист «как в техпаспорте»: PDF в масштабе** (A4/A3, 1:50/1:100/1:200), рамка листа видна на холсте, «область печати» рамкой, предустановка «чистый план» (стены + проёмы + размеры + подписи, без мебели и электрики) и «план с мебелью» | #446 (7 голосов, 2011→2024), #607 (6), #617 (5), #526, #300, #754, #833 («show the edges of chosen paper format»), отзыв SF стр. 2 № 24; баги печати #211/#409 | Только PNG/SVG (`exporters.ts:25–29`, `PlannerPage.tsx:3306–3307`); слои при экспорте уже учитываются (`PlannerPage.tsx:3575`) | **Высокая** — это то, что несут прорабу и в БТИ | 3–4 дня (SVG → PDF через jsPDF+svg2pdf, масштаб см→мм, рамка на холсте) |
| 2 | **«Размеры всего плана» одной кнопкой**: наружные габариты, внутренние по каждой комнате, расстояния проёмов до ближайшего угла, всё привязано к стенам; переключатель «внутренние / наружные / обе» | #819, #232 (7), #647 (3), #1009; отзыв «essential dimensions to be PERMANENTLY overlayed» | Есть «Размеры комнаты на план» по одной комнате (`PlannerPage.tsx:2350`), `followDims` (`dims.ts:133`) | **Высокая** — техпаспорт и проверка распознавания | 2–3 дня |
| 3 | **Толщина стены с выбором стороны роста**: «утолщать наружу / внутрь / по оси» в свойствах, а при распознавании и обводке — наружные стены растут наружу от комнат, перегородки — по оси | #1059, #1129, #71, #765, #1130 (патч «alignment left/middle/right»), #750 (8) — самый долгий незакрытый спор трекера | Длина по грани есть (`walledit.ts:211,235`); `setRunThickness` (`walledit.ts:465–470`) меняет только `thickness`, ось на месте → рост симметричный; в UI `<select>` без выбора стороны (`PlannerPage.tsx:2157–2158`) | **Высокая** — не ломает размер комнаты «в чистоте» при уточнении толщины после фото | 1–2 дня |
| 4 | **Смета отделки рядом с ведомостью электрики**: площадь квартиры с/без стен, по комнатам; периметры (плинтус); площадь стен за вычетом проёмов (обои/краска); площадь пола/потолка; длина наружных/внутренних стен; поле «цена за м²/м.п.» → итог; CSV | #538 (6), #821, #736 (3), #144 (2009→2026 «anyone help me?»), #1181 («don't hope this feature… in a close future») | `rooms.ts:216 perimeter`, показ в панели комнаты (`PlannerPage.tsx:2334`); ведомость только по электрике (`:2957`) | **Высокая** — та же аудитория, что и электрика: «поговорить с ремонтниками с цифрами» | 2–3 дня |
| 5 | **Электрический план как отдельный лист с легендой** по ГОСТ 21.210-2014 (условные обозначения розеток/выключателей/светильников/щита), экспорт вместе с планом; «стены + сети» без мебели | #421 («standard symbols in the right places»), #835 («légende éditable… vrai tableau électrique»), #328, #274 — 15 лет просьб, ответ «плагин» | `electricplan.ts` считает всё; на плане — значки и пунктир трасс (README) | **Высокая** — главный дифференциатор, его надо уметь распечатать | 2–3 дня |
| 6 | **Замок на любой объект** (мебель, электроточки, подложка, размеры) и «заблокировать всё, кроме мебели» (аналог «Lock base plan», но выборочно); значок замка в панели; «снять все замки» одной кнопкой | #1277 (2026), #1265 (2025), #573, #133 (v1.8 lock base plan), #666 («unhide all objects» как обязательная пара) | Замок только у стен (`types.ts:14`) и подложки (`types.ts:182`); режимы «Стройка/Мебель/Электрика» уже не дают задеть чужое (README) | Средняя — режимы закрывают 80 %, замок нужен для «финального» плана | 1–2 дня |
| 7 | **Размеры, привязанные к мебели и проёмам** («от стены до кровати 70», «от угла до двери 15»), которые едут за объектом и подсказывают при перетаскивании | #609 (6), #820, #1009 | `followDims` только по стенам (`dims.ts:133`) | Средняя — усиливает проверки эргономики визуально | 2 дня |
| 8 | **Строка состояния/HUD**: координаты курсора, длина + угол текущей стены, ширина/глубина выделенного; ввод угла через Tab после длины (как Enter в SH3D, но без диалога) | #833, #1186, #595, users-guide («enter the length and the angle… after pressing the enter key») | Длина цифрами есть (`PlannerCanvas.tsx:342`), угла — нет | Средняя — для нестандартных углов (эркер, скошенная прихожая) | 1–2 дня |
| 9 | **Направляющие линии** перетаскиванием с линеек + магнит к пересечениям; настраиваемый шаг сетки уже есть | #1085, #407 (4; «a quarter to half my time… trying to get walls to line up»), #592, #833 | Сетка с шагом (`PlannerPage.tsx:3238`), привязки в `snapping.ts` | Средняя — при ручной обводке плохих фото | 2 дня |
| 10 | **«Прозрачные/скрытые стены» и срез в 3D**: переключатель «без потолка / наружные стены прозрачны / скрыть выделенную стену», подсказка про панорамирование | #666 (5), #1271, #856 (8 — pan в 3D), #726 | `View3D.tsx:211 OrbitControls` без `enablePan=false` → pan работает правой кнопкой/двумя пальцами, но подсказки об этом в `View3D.tsx` нет (grep) | Средняя — показ AR/3D заказчику | 1 день |
| 11 | **Панель «Стены»** списком: длина по оси/внутри/снаружи, толщина, замок, «выделить на плане»; для распознанного плана — быстрый аудит «что нашлось» | #1069, #1276, #565 | Нет | Низкая/средняя — полезно для проверки распознавания | 1–2 дня |
| 12 | **Высота стены / полустена** (перегородка 120 см, барная стойка, бортик над кухней) | #846 (3), отзыв SF стр. 1 № 14, #516 | `WALL_H = 270` константа (`scene3d.ts:13`) | Низкая/средняя — редкий кейс в квартирах | 2 дня |
| 13 | **Тёмная тема** | #824 (5), #573 | `planner.css` — ни `prefers-color-scheme`, ни `data-theme` нет (grep) | Низкая — но дёшево и заметно на телефоне | 1 день |
| 14 | **«Почему так» прямо в интерфейсе**: у «Длину считать» и у толщины — «?» с картинкой ось/внутри/снаружи; в проверках — ссылка на норму | #375 (автор SH3D признаёт: «I should add an entry in the FAQ about this»), #1268 | Подсказки текстом в панели (README) | Низкая — снимает вопросы поддержки | 0,5 дня |
| 15 | **Осознанно не делать**: ландшафт (#511, 10), крыши (#466, #864), лестницы (#618), GPU-фоторендер (#593, 12), DWG/IFC (#1079). Это дом, а не квартира, и не браузер | Топ трекера SH3D | — | — | 0 (зафиксировать в README как границы продукта) |

Порядок, если делать подряд: 1 → 3 → 2 → 5 → 4 → 6 → 8 → 7 → 10 → 9 → 14 → 11 → 13 → 12.

### Что у нас уже сильнее лидеров (не трогать, показывать в онбординге)

- **Стена по грани и число «в чистоте»** — 18-летний открытый спор SH3D (#71 → #1268) у нас решён: `walledit.ts:211 refLength`, `:235 setRunLengthBy`, щелчок по подписи стороны комнаты (README).
- **Комнаты живут за стенами** — #832/#765 («Walls and rooms are not bound») у нас невозможны по построению: комнаты — замкнутые контуры (`rooms.ts`), после правки чертёж склеивается (`walledit.ts:367 normalizeWalls`), разрыв контура называется сразу.
- **Размеры привязаны к стенам** (#609/#819/#1009) — `dims.ts:133 followDims` на каждую правку истории.
- **Замок стены** (#1277/#1265) — `types.ts:14`, `walledit.ts:478 touchesLocked`, `:494 setRunLocked`, `:502 setAllLocked`.
- **Электрика по нормам с щитом** (#274/#328/#421/#835/#1070/#1199) — `electricplan.ts`; ни у SH3D, ни у Foyr этого нет; у Cedreo — «electrical plans» без расчёта [предположение].
- **Распознавание плана БТИ с проверкой по подписям** — у SH3D фон-картинка и «draw walls upon it» (#765, автор); у Cedreo/Foyr в доступных источниках распознавания нет.
- **Режимы «Стройка/Мебель/Электрика»** — SH3D предлагает «Lock base plan» на всё разом (#133) и «уровни как слои» (#972); у нас режим сам решает, что цепляет мышь (README).
- **Ввод длины во время рисования без диалога** — в SH3D Enter открывает поля и не работает в Online/Mobile; у нас цифры прямо в холсте (`PlannerCanvas.tsx:342`).

---

## Приложение: источники

Sweet Home 3D (все прочитаны целиком, curl 2026-09-26):
- Список по голосам: https://sourceforge.net/p/sweethome3d/feature-requests/search/?q=%21status%3Aclosed&sort=votes_total_i+desc&limit=100 (страницы 0–1)
- Тикеты: /750/, /232/, /609/, /647/, /832/, /407/, /1130/, /375/, /919/, /637/, /592/, /848/, /1059/, /1268/, /846/, /1085/, /998/, /1009/, /133/, /446/, /607/, /617/, /819/, /1079/, /754/, /847/, /615/, /274/, /328/, /835/, /1070/, /1199/, /538/, /821/, /736/, /144/, /593/, /511/, /856/, /666/, /824/, /972/, /565/, /716/, /508/, /1277/, /765/, /1129/, /71/, /1052/, /421/, /1278/, /720/, /820/, /1186/, /833/, /573/, /1265/, /1172/, /1069/, /1181/ — все по адресу https://sourceforge.net/p/sweethome3d/feature-requests/<номер>/
- Баги: https://sourceforge.net/p/sweethome3d/bugs/ (405 открытых, без голосов)
- Отзывы: https://sourceforge.net/projects/sweethome3d/reviews/ и ?page=2 (4,7/5, 301)
- Файлы/версии: https://sourceforge.net/projects/sweethome3d/files/SweetHome3D/ (7.5 — 2024-08-21)
- Страница проекта: https://sourceforge.net/projects/sweethome3d/

Сниппеты поиска (страницы не читались):
- https://www.sweethome3d.com/users-guide/ ; https://sbcode.net/sh3d/drawing-walls/ ; https://roomfit.app/blog/en/sweet-home-3d-tutorial/
- https://www.sweethome3d.com/blog/more-modification-capabilities-in-sweet-home-3d-online/ ; https://www.sweethome3d.com/SweetHome3DJSOnline.jsp
- https://www.capterra.com/p/164019/Sweet-Home-3D/reviews/ ; https://www.getapp.com/industries-software/a/sweet-home-3d/reviews/
- Cedreo: https://justcreative.com/cedreo-review/ ; https://www.capterra.com/p/177284/Cedreo/ ; https://www.itqlick.com/cedreo ; https://www.geniusfirms.com/review/cedreo/
- Foyr Neo: https://www.capterra.com/p/204757/Foyr-Neo/reviews/ ; https://www.trustradius.com/products/foyr-neo/pricing ; https://www.saasworthy.com/product/foyr-neo ; https://www.softwareworld.co/software/foyr-neo-reviews/

Cedreo / Foyr Neo (прочитаны через WebFetch):
- https://sourceforge.net/software/product/Cedreo/ ; https://sourceforge.net/software/product/Cedreo/reviews/
- https://sourceforge.net/software/product/Foyr-Neo/ ; https://sourceforge.net/software/product/Foyr-Neo/reviews/
- https://sourceforge.net/software/compare/Cedreo-vs-Foyr-Neo/
