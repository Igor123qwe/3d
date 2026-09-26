# Лидеры массового сегмента: Planner 5D, Homestyler, Coohom

Дата: 2026-09-26. Метод: WebSearch (англ. + рус.), сниппеты help-центров, форумов, App Store / Google Play / Trustpilot / Capterra через агрегаторы. WebFetch к сайтам конкурентов закрыт прокси, поэтому цитаты — из поисковых сниппетов, а не из полного текста страниц; там, где сниппет мог быть урезан, это отмечено. Метки: **[проверено: ссылка]** — факт виден в сниппете названной страницы; **[по памяти]** — знание без свежего подтверждения; **[противоречие]** — источники расходятся; **[предположение]** — моя интерпретация.

Наш продукт для сравнения: `/home/user/3d` (README.md; `src/planner/walledit.ts`, `dims.ts`, `underlay.ts`, `planai.ts`, `electricplan.ts`, `StartDialog.tsx`, `templates.ts`).

---

## 0. Резюме

1. **Распознавание плана у всех трёх — «загрузил и жди», а не интерактивный инструмент.** Planner 5D: файл уходит в фоновую очередь, help-центр обещает «от 10 минут до 24 часов» и письмо на почту; маркетинговая страница при этом пишет «за 5 секунд» [противоречие]. Homestyler и Coohom: 15–45 с / «около 3 минут», результат — стены/двери/окна без чисел с плана; масштаб пользователь задаёт сам «одним известным размером». Никто из троих не читает подписи размеров и площадей с чертежа БТИ и не сверяет результат с ними — это наше отличие (`planai.ts: scaleFromLabels`, `fitResultToLabels`, диалог «Распознано» с процентом схождения).
2. **Правка стен — главный источник негатива у Planner 5D.** Ниша или выступ делаются через «разбей стену на 3–4 куска → тяни средний → спрячь лишнее»; двери и окна «прыгают» и «прилипают не к той стене», настройка привязки сбрасывается при выходе из проекта; «на кухню с разной длиной стен ушло 4 часа». Наш подход (прямая целиком, тянуть только поперёк, Alt — участок, замок) закрывает ровно эти боли.
3. **Coohom — лучший образец точной правки:** длина вводится щелчком по числу на размерной линии с выбором, в какую сторону расти; пробел переключает опорную линию (внутри/ось/снаружи) во время рисования; Shift — ортогональность; выравнивание стен по внутренней/осевой/наружной грани; «замок размера». Это стоит перенять почти дословно.
4. **Homestyler — единственный из троих с инженерной электрикой в массовом продукте** (V5.0: группы WL/WX/WP-K/WP, связь «выключатель → светильник», чертежи розеток/выключателей/сантехники), но она ручная и без проверки норм; у нас — группы щита, кабель, автоматы и замечания по ПУЭ, чего у них нет.
5. **Что ругают везде одинаково:** биллинг и автопродление (Trustpilot Planner 5D 2.5/5 при 4.5–4.7 на G2/Capterra; Coohom — «счёт на 453 $ после отмены»), крэши и потеря часов работы в мобильных приложениях, залоченный каталог и водяные знаки, недоступный саппорт. Никто не хвалит точность плана — хвалят «красивые рендеры» и «легко начать».
6. **Чего нет у нас и есть у них:** PDF/чертёж в масштабе с рамкой (Homestyler/Coohom), DWG/DXF импорт и экспорт, выбор страниц из многостраничного PDF (Planner 5D), несколько вариантов ИИ-расстановки на выбор (Smart Wizard), бюджет/список покупок с ценами (Planner 5D «Find Furniture», Coohom checkout list), полустены и высота стены (Homestyler «Partial», Coohom), совместная работа по ссылке с правами (все трое), история версий проекта «File → Version History» (Homestyler, Coohom; у Planner 5D не найдена).
7. **Замок стен есть у всех троих, но по-разному:** Planner 5D — выключатель «Lock Walls / Lock Rooms» на весь проект в настройках; Homestyler — галочка «Unlock Walls» в свойствах пустого выделения (частая причина вопроса «impossible to change the wall dimensions»); Coohom — замок на выбранные структуры (Shift-выбор → Lock). У нас — на одну стену (`types.ts:14 locked`) и на все разом (`setAllLocked`), а `touchesLocked` не даёт утащить соседа зафиксированной стены.

---

## 1. Кто есть кто (уточнение к вводной)

- **Planner 5D** — литовско-американская компания, веб + iOS + Android + macOS + Windows; каталог «10 000+» на странице цен (в других местах 8 000+) [проверено: https://planner5d.com/pricing через сниппет; https://www.architecturelab.net/software/planner-5d/].
- **Homestyler** — бывший продукт Autodesk, в 2018 куплен Easyhome (Juran); по странице «About» — «jointly invested by Alibaba Group and Easyhome New Retail Group» [проверено: https://www.homestyler.com/about/story]. Один блог называет Homestyler «sibling Coohom от Manycore» [противоречие: https://www.meltflexai.com/blog/coohom-ai-interior-design-review]; официальные источники этого не подтверждают.
- **Coohom** — международная версия Kujiale от Manycore Tech (Ханчжоу), запущена в 2018 [проверено: https://en.wikipedia.org/wiki/Manycore_Tech]. Так что «Alibaba/Kujiale» из вводной — это два разных владельца: Alibaba/Easyhome → Homestyler, Manycore/Kujiale → Coohom.

---

## 2. Planner 5D

### 2.1 Распознавание плана с картинки («Upload a Plan» / «AI Plan Recognition»)

**Как устроено (по help-центру):**
- Форматы: JPG, PNG, PDF, DXF. Для PDF система «сканирует документ, находит страницы, похожие на планы, и даёт выбрать только их» [проверено: https://support.planner5d.com/en/articles/14434484-how-to-upload-a-floor-plan].
- Запуск: Spaces → «+ Create» → «Upload a Plan» → файл → «распознавание запускается в фоне» [проверено: https://support.planner5d.com/en/articles/7458952-using-upload-a-plan-feature].
- Время: «AI plan recognition generally takes between 10 minutes and 24 hours… you'll receive an email once your project is ready» [проверено: 14434484]. На маркетинговой странице — «raising them into 3D geometry in under 5 seconds» [проверено: https://planner5d.com/ai] [противоречие]. Окно 10 мин – 24 ч + письмо характерно для очереди с ручной доводкой или пакетной обработки [предположение, не подтверждено].
- Масштаб: «after uploading your floor plan, you'll need to adjust the scale using the scaling tool to match the plan's measurements with the real-life dimensions» [проверено: 14434484]. То есть подписи размеров с плана не читаются — масштаб задаёт пользователь.
- Если стены пропали: «crop the image to remove extra white space, increase contrast to make walls darker, or manually add missing walls» [проверено: 14434484].
- Доступ: только платные тарифы; число распознаваний «зависит от типа Premium-подписки», на PRO — безлимит [проверено: https://support.planner5d.com/en/articles/15128965-planner-5d-subscription-types].

**Что ругают:**
- «uploaded floor plans are substantially misinterpreted, with garages becoming bedrooms, outdoor living areas labeled as garages, and rooms incorrectly divided» [проверено: Trustpilot через https://checkthat.ai/brands/planner-5d/reviews].
- «the app can create 2 interior overlapping walls that don't line up properly, with corners that won't align and walls that cannot be deleted» [проверено: там же].
- «the AI moves walls without being asked» (Google Play) [проверено: там же].
- «the floorplan import feature has created weird false walls making future edits impossible» [проверено: Trustpilot через https://checkthat.ai/brands/planner-5d/reviews].
- Обзор Interior Index: маркетинг обещает «1–2 minutes», help-центр — «10 minutes to 24 hours»; «many uploads require manual correction even after successful processing» [проверено: https://interiorindex.org/tool-reviews/planner-5d-review/] — третья цифра к тому же противоречию.

**Вывод:** результат — стены как геометрия без чисел; нет отчёта, что и насколько сошлось; нет привязки к подписям; ожидание до суток. У нас (`planai.ts`, диалог «Распознано») это уже сильнее.

### 2.2 Рисование стен

- Инструменты: «Add Room» (готовые формы комнат), «Pencil» (стены по точкам), «Partition wall» [проверено: https://support.planner5d.com/en/articles/5876887-using-a-partition-wall-function-web; https://support.planner5d.com/en/articles/5897744-adding-a-room-ios].
- Перегородка карандашом: «select the wall where you want the partition to begin, draw a line to the opposite wall where you want it to end, and click the same point again to finish» [проверено: https://support.planner5d.com/en/articles/15934552-how-to-create-partition-walls].
- Ввод длины при рисовании с клавиатуры — в help-центре не найден [не найдено]; длина правится после, в поле.
- Привязки: к стенам есть (двери/окна «snap to any wall they near… matching that wall's angle»). Настройки привязки спрятаны глубоко: Android — «Settings (⚙️) → Project settings → Advanced settings → Controls and navigation», сетка — отдельно «Settings → Grid» [проверено: https://support.planner5d.com/en/articles/13044756-how-to-align-objects-android]. Режим 45°/ортогональности при рисовании не описан [не найдено]; угол чего угодно задаётся только перетаскиванием «rotation circle», числового ввода угла нет [проверено: https://support.planner5d.com/en/articles/15859960-how-to-rotate-items].

### 2.3 Правка стен и комнат (особое внимание)

**Что происходит при щелчке по стене:** стена выделяется, внизу появляется «settings line» с полями Length / Thickness (и высотой); ввод числа + Enter меняет длину [проверено: https://support.planner5d.com/en/articles/7210615-how-to-resize-a-room; https://support.planner5d.com/en/articles/5876845-changing-dimensions-web]. В какую сторону растёт стена — не описано [не найдено].
**Как двигают:** «select the wall… drag the wall to increase or decrease the size of the room» или «drag the corner to resize it manually» [проверено: 7210615].
**Толщина:** для одной стены (выделить стену) или всей комнаты (выделить комнату — применится ко всем её стенам) [проверено: https://support.planner5d.com/en/articles/15701690-how-to-change-wall-thickness].
**Ниша/угол/выступ:** «break a wall into three pieces with the wall division tool and then drag the corner out» [проверено: https://support.planner5d.com/en/articles/5876834-adding-corners-web]; для перегородки альтернативно «split a wall into four pieces, then drag the center wall segment into the room… drag the two outer corners together» [проверено: 15934552].
**Удалить часть стены:** «divide the single wall into pieces first using the Split option, then tap it again to use the Hide button» [проверено: https://support.planner5d.com/en/articles/7459522-deleting-part-of-the-wall-ios].
**Склеить обратно:** «select the joint point… drag this point to the closest other point on the second wall piece… release to merge» [проверено: https://support.planner5d.com/en/articles/8123706-unsplitting-the-wall-ios].
**Замок стен:** есть, но как настройка всего проекта, а не свойство стены — «Lock Walls prevents accidental wall movement… turn on Lock Walls in your project settings… walls will stay in place while you continue placing and moving furniture»; рядом «Lock Rooms» (комнаты и стены нельзя ни двигать, ни менять) и «Hide Objects» [проверено: https://support.planner5d.com/en/articles/13042256-how-to-lock-rooms-and-hide-objects-android; https://support.planner5d.com/en/articles/12978550-how-to-lock-rooms-and-hide-objects-in-your-project-ios; https://support.planner5d.com/en/articles/8015457-how-to-unlock-objects-in-windows-app]. Замка на одну стену не найдено [не найдено]; у нас — и на одну (`types.ts:14 locked`, `walledit.ts:494 setRunLocked`), и на все (`setAllLocked`).

**Что ругают (дословно):**
- «Moving walls and changing room dimensions is nearly impossible and definitely not intuitive» [проверено: Capterra/App Store через https://justuseapp.com/en/app/606173978/planner-5d-interior-design/reviews].
- «kitchen with walls of differing lengths took over 4 hours to get even close to accurate» [проверено: там же].
- «When creating walls, the program is a bit touchy... Sometimes when trying to move or modify a wall it would take other walls with it» [проверено: Capterra https://www.capterra.com/p/164022/Planner-5D/reviews/].
- «walls shifting in size without any prompting», «design edits get reverted» [проверено: https://checkthat.ai/brands/planner-5d/reviews].
- Русский отзыв: «возможность испортить работу одним движением без возможности отмены» [проверено: https://a2is.ru/catalog/programmy-dlya-stroitelstva-i-remonta/planner-5d/reviews-planner-5d].
- Русские отзывы (vraki.net, пересказ агрегатора): «при попытке установить размеры комнаты уже настроенные стены сбиваются — несколько часов попыток добиться правильных размеров двух комнат»; «постоянная смена ширины стен вызывает пересчёт общей площади»; «объекты прыгают, очень сложно поставить именно туда, куда хочется»; «очень неудобно, что нельзя сделать потолок» [проверено: https://vraki.net/otzyvy/mobilnye-prilozheniya/planner-5d-planirovshchik-domov-i-interera.html; https://vraki.net/otzyvy/mobilnye-prilozheniya/planner-5d-planirovshchik-domov-i-interera/ochen-neudobno-chto-nelzya.html].

**Вывод:** парадигма «стена = кусок, любая операция = разбей/тяни/спрячь» — ровно то, от чего мы ушли в `walledit.ts` (прямая целиком `wallRun`, `pushRun` поперёк с примыкающими, `deleteSection` для проёма, `normalizeWalls` — склейка после правки, `setRunLocked`).

### 2.4 Размеры и единицы

- Меню «Dimensions» через шестерёнку справа вверху: единицы (метрические/имперские), показ размеров, «цвет размерных стрелок» [проверено: https://support.planner5d.com/en/articles/6579117-changing-metrics-unit-other-dimensions-settings-web; https://support.planner5d.com/en/articles/16963387-how-to-change-dimensions-and-measurement-units].
- Размеры объекта — «width, depth, height in the settings line at the bottom» [проверено: 5876845].
- Рулетка: «Ruler can only be used in 2D mode»; можно задать точную длину рулетки [проверено: https://support.planner5d.com/en/articles/5876799-measuring-the-distance-using-a-ruler-web].
- Размер «в чистоте» vs по оси — выбора нет [не найдено]. У нас: «Длину считать: по оси / внутри / снаружи» (README; `walledit.ts: refLength`, `setRunLengthBy`).

### 2.5 Двери, окна, проёмы

- Перетащить виджет на стену; двигать вдоль стены; тап — панель Edit (ширина/высота/высота от пола, направление открывания); типы: входные, раздвижные, арки, французские [проверено: https://support.planner5d.com/en/articles/12906280-how-to-add-windows-android; https://www.techradar.com/reviews/planner-5d].
- Привязка: «Windows and doors snap to any wall they near as you drag them, matching that wall's angle» [проверено: TechRadar].
- **Боль:** «It always snaps doors and windows to walls that they're not supposed to be on. This snapping setting can be turned off while in a project, but resets once you exit the project» [проверено: App Store через justuseapp]; «Windows and doors skip around once added to a wall. I often have to put them back in place several times before they stuck» [проверено: там же].

### 2.6 Каталог мебели и техники

- «10 000+» на pricing (сент. 2026); в обзорах — «8 000+» [проверено: https://planner5d.com/pricing; https://www.architecturelab.net/software/planner-5d/] [противоречие по числу].
- Free: часть каталога залочена; оценки от «около половины» до «~80 предметов» [противоречие: https://getpulsesignal.com/pricing/planner5d vs https://www.coohom.com/article/is-planner-5d-free — второй источник конкурент].
- Боль: «You might design a room around a specific sofa style only to discover it's locked behind Premium» [проверено: https://www.firstchair.app/blog/planner-5d-pricing]; «Limited range of furniture and decor options» [проверено: Capterra].
- Загрузка своих 3D-моделей — только Professional [проверено: getpulsesignal].

### 2.7 Отделка (материалы, цвета)

- Вкладка материалов: покраска стен/полов текстурами и цветом; часть текстур платная [по памяти]. В сниппетах — только «adjusting room colors, modifying textures» [проверено: https://planner5d.com/ai].

### 2.8 ИИ-функции

- **Smart Wizard** (автогенерация комнаты): 1) выбрать одну из **шести форм комнаты** и ввести размеры; 2) тип комнаты (kitchen, bathroom, bedroom, living room, kids' room, home office); 3) стиль (industrial, boho, classic, Japanese, minimalist, Scandinavian, country); результат — **несколько вариантов расстановки**, «considers walls, doors, windows, and available floor space», каждый можно доработать [проверено: https://support.planner5d.com/en/articles/6117935-smart-wizard; https://planner5d.com/smart-wizard].
- **AI Furniture Placement** — отдельная страница, суть та же [проверено: https://planner5d.com/use/ai-furniture-placement]. Smart Wizard — **только Premium**: «To use the Smart Wizard tool… you need to unlock Premium» [проверено: https://planner5d.com/blog/upgrade-to-planner-5d-premium/].
- **Design Generator** (iOS): загрузить фото интерьера → указать тип комнаты → «шесть AI-рендеров в разных стилях» в галерее [проверено: https://support.planner5d.com/en/articles/7218617-design-generator-ios]. Это image-to-image, не планировка.
- Проверки эргономики/геометрии после ИИ — не найдены [не найдено]. У нас — `checks.ts` (проходы, двери, рабочий треугольник) и `furnish.ts` с проверкой геометрией.

### 2.9 Электрика, инженерка, сметы

- Электрики как проекта нет [не найдено; по памяти — в каталоге есть декоративные розетки/светильники].
- **Budget Calculator / «Find Furniture»**: «press the Find Furniture button in the side menu… searches local websites based on your country to find exact or similar items, compiling a list with their prices» [проверено: https://support.planner5d.com/en/articles/9564673-budget-calculator-for-your-project]. Переключатель «budget / luxury» [проверено: сниппет там же].
- Страницы planner5d.com/costs/* — SEO-калькуляторы стоимости работ (по BLS США), к проекту не привязаны [проверено: https://planner5d.com/costs].

### 2.10 3D, рендер, VR, AR

- Рендер: Free — draft с водяным знаком; Premium — standard (в одном сниппете «5 renders per month»); Professional — 4K без лимита, 360-панорама, walkthrough [проверено: https://support.planner5d.com/en/articles/15128965; https://planner5d.com/pro/4k-renders].
- **360 Walkthrough**: камера-иконка → «360 Walkthrough» → расставить камеры → «Generate» → «within 30 minutes… appear in the Renders folder» [проверено: https://support.planner5d.com/en/articles/10581383-360-walkthrough-feature].
- AR: «AR Try-on» и «AR with Planner 5D» только iOS; отдельное приложение под Apple Vision Pro [проверено: https://support.planner5d.com/en/articles/7244303-ar-try-on-tool-ios; https://planner5d.com/applevisionpro].

### 2.11 Экспорт, печать, масштаб, DXF/PDF

- **Export to CAD**: «Share → Export to CAD → .dwg или .dxf»; **только PRO**; «exported in 2D… does not have an option to export it in 3D» [проверено: https://support.planner5d.com/en/articles/9582739-export-projects-in-dwg-or-dxf-formats].
- **PDF — только через печать браузера и только на вебе:** «Adjust the zoom level so that everything you want to include in the PDF is visible on the screen → Print → Save as PDF» [проверено: https://support.planner5d.com/en/articles/5876838-printing-projects]. Масштаба листа (1:50, 1:100), рамки и штампа нет — что влезло в экран, то и напечаталось. 2D-план скачивается картинкой [по памяти].

### 2.12 Облако, совместная работа, версии

- Приглашение по ссылке/почте с ролями view / comment / edit; «Live Collaboration» на вебе — одновременная правка, «every change appearing instantly» [проверено: https://support.planner5d.com/en/articles/15116256-how-to-share-projects; https://planner5d.com/collaboration-tool]. По сниппету — доступно и на Free [проверено: https://planner5d.com/pricing через сниппет; требует перепроверки].
- История версий — не найдена [не найдено].
- Боль: «Sync issues between devices, slow file downloads, and file sharing problems… 2025 and 2026 reviews repeating the same crash, sync, and export complaints» [проверено: https://checkthat.ai/brands/planner-5d/reviews].

### 2.13 Мобильные приложения

- iOS/Android/macOS/Windows; help-центр ведёт отдельные статьи под каждую платформу (значит, поведение различается) [проверено: список статей support.planner5d.com].
- Боли: «locked out after placing one item, requiring navigating through several paywalls to perform basic actions» [проверено: Trustpilot через checkthat]; «Приложение загружается очень долго и иногда требует использования нескольких устройств, чтобы в итоге открыться» [проверено: https://a2is.ru/... reviews-planner-5d]; крэши и потеря правок [проверено: Capterra].

### 2.14 Онбординг, обучение, шаблоны

- Экран Spaces → «+ Create» → «empty project, template, Upload a Plan, или другой доступный вариант (AI)» [проверено: https://support.planner5d.com/en/articles/13038612-how-to-create-a-new-project]. Наш `StartDialog.tsx` — те же четыре входа (загрузить / шаблон / с нуля / продолжить).
- Курс «How to use Planner 5D», блог «Beginner tips» [проверено: https://planner5d.com/interior-design-courses/how-to-use-planner-5d].
- Саппорт-бот «Bernard»: «it forgot the request I made… the chat disappeared again» [проверено: Capterra через сниппет].

### 2.15 Free и цена

- Premium ≈ $19.99/мес или $59.99/год; Professional ≈ $49.99/мес или $399.99/год (снимки третьих лиц, 2026) [проверено: https://getpulsesignal.com/pricing/planner5d; https://www.firstchair.app/blog/planner-5d-pricing — не первоисточник]. Русский отзыв: «около 5000 рублей в месяц» [проверено: a2is.ru].
- Trustpilot 2.5/5 против 4.48–4.7 на G2/Capterra; доминируют жалобы на биллинг: «charged for canceled subscriptions», «system designed to make it as difficult as possible to cancel» [проверено: https://www.trustpilot.com/review/planner5d.com через checkthat].

### 2.16 Сильные стороны Planner 5D

- Самый низкий порог входа из троих: «more intuitive… easier to learn» [проверено: https://www.spacesbydee.com/coohom-vs-planner-5d-which-floor-planner-is-better/].
- Smart Wizard даёт **несколько вариантов** расстановки на выбор — у нас один результат.
- Один продукт на 5 платформах + живая совместная правка.
- Budget Calculator привязан к стране пользователя.

---

## 3. Homestyler

### 3.1 Распознавание плана с картинки

- Вход: DWG/DXF/PDF/JPG/PNG; «Upload a floor plan or sketch in 2D, and Homestyler AI will convert it into an editable 3D house model with one click» [проверено: https://www.homestyler.com/article/floorplanner/how-to-upload-your-floor-plan-to-homestyler].
- Для CAD: «Homestyler only supports the recognition of double-line walls. If a single-line drawing is used, it will cause the drawing import to fail» [проверено: https://www.homestyler.com/forum/view/1635960405562134529].
- Рекомендации к картинке: чёрные линии на белом, 150–300 DPI, «Focus on the walls, doors, and windows, without furniture, notes, electrical layouts, or dimension lines»; этажи загружать по отдельности, иначе «AI may become confused and erroneously stack them» [проверено: https://www.homestyler.com/article/mastering-ai-floor-plan-conversion].
- Масштаб: «Refinement… involves inputting at least one known measurement to rescale the plan correctly»; «AI reads proportions well but lacks intrinsic scale knowledge» [проверено: https://www.homestyler.com/article/trends/create-accurate-floor-plans-from-photos]. Время: «about 3 minutes AI processing plus 20 to 25 minutes of editing» [проверено: там же].
- Фото угла комнаты (два-три видимых стены) — тоже принимается как вход для «оценки стен, дверей, окон» [проверено: там же]; точность «±2 cm» в App Store — маркетинг [проверено: https://apps.apple.com/us/app/homestyler-ai-room-planner/id601137449].
- **AI Planner (март 2026)**: «generate customized floor plans in 3 steps» — из размеров/эскиза/текста [проверено: https://resources.homestyler.com/2026/04/14/homestyler-releases-version-6-0-...; https://www.homestyler.com/about/updates].
- Отзыв: «was able to upload their current plans and reported the app did great recreating them, though they had to move some walls» [проверено: justuseapp Homestyler].
- [противоречие] Обзор Remodel AI (2026): «Homestyler does not generate layouts from AI or from photos… you draw the room outline yourself, then furnish it» [проверено: https://www.remodelai.io/blog/best-free-ai-floor-plan-apps] — расходится с официальными страницами Homestyler; вероятно, тестировали мобильное приложение, где загрузка плана «only uploads the current picture» (см. 3.13).

### 3.2 Рисование стен

- «draw any straight wall on the canvas and **directly input the length value of the wall when drawing**, then press Enter»; сверху — «Wall Thickness» и «Orthogonal mode»; замкнутый контур «automatically form a room» [проверено: https://www.homestyler.com/forum/view/1486264945836707841].
- Шаблоны формы комнаты (прямоугольник, L) [проверено: https://www.homestyler.com/learn/floor-plan_sketch-floor-plan-and-draw-rooms].

### 3.3 Правка стен и комнат

- Выделил стену в 2D → справа панель свойств: тип стены, толщина; без выделения — высота и толщина стен всей комнаты [проверено: forum 1486264945836707841].
- Как двигают: «left-click to select the wall in 2D plane view, and drag to modify the dimension… or directly type in a distance value to adjust the room size and wall position»; длины/высоты «can be changed in plane view by clicking on adjacent walls and manually inputting dimensions in a highlighted box», но «can't be done in 3D/roam/RCP views» [проверено: https://www.homestyler.com/forum/view/1494589724393631746; https://www.homestyler.com/forum/view/1563082204886441985].
- Замок: галочка «Unlock Walls» в панели свойств при пустом выделении («left-click the blank space… go to the properties panel on the right to close the Unlock Walls option»); типичная тема форума «impossible to change the wall dimensions (length and height)» решается именно ей [проверено: https://www.homestyler.com/forum/view/1607296553112801281; https://www.homestyler.com/forum/view/1509950612570583042].
- Операции: «split a wall, connect it to another, align it with another, or turn a straight wall into an arc… as long as they're in 2D view»; «the wall supports precise splitting and independent movement» [проверено: https://www.homestyler.com/about/updates; форум].
- Высота одной стены: «toggle the wall type from Full to Partial» в панели справа внизу [проверено: https://www.homestyler.com/forum/view/1486164437042106370].
- Боль (рус.): «Невозможно начертить комнату по размерам, программа зависает и плохо редактируется» [проверено: https://partnerkin.com/services/homestyler/reviews].

### 3.4 Размеры и единицы

- «File → Preference → Measurement Unit» mm/cm/m/ft [проверено: https://www.homestyler.com/forum/view/1394726942529441793].
- Отдельные галочки: скрыть площади / скрыть длины стен [проверено: форум].
- В режиме чертежа: «Annotation Scale» внизу — выбор масштаба листа [проверено: https://www.homestyler.com/forum/view/1640998543632289794].
- Боль: «Measurement units change when I export floor plan» [проверено: https://www.homestyler.com/forum/view/1708528443315822594].

### 3.5 Двери, окна, проёмы

- Перетаскивание на стену; боль: «doors opening from the handle side instead of the hinge side»; совет саппорта — «add the doors and windows directly to the wall without making the wall opening» [проверено: https://www.homestyler.com/forum/view/1865818123191263234]; «can't see doors in floorplan» [проверено: https://www.homestyler.com/forum/view/1390789376544862209].
- «Some door and window dimensions cannot be changed, and dragging and dropping stairs is difficult due to anti-collision rules» [проверено: https://sourceforge.net/software/product/Homestyler/ через сниппет].

### 3.6 Каталог

- «1,000,000+ drag-and-drop furniture and material models», брендовые каталоги [проверено: https://www.homestyler.com/solution/design_floor-planner]. Часть моделей за «coins» (200–500) [проверено: App Store через justuseapp].
- Боль: «В каталоге мебели сложно ориентироваться» [проверено: partnerkin].

### 3.7 Отделка

- Материалы/краска; боль: «you can't change the floor anymore and the entire wall lettering section has been removed»; в челленджах «can no longer choose paint color» [проверено: App Store через justuseapp].

### 3.8 ИИ-функции

- Март 2026 «AI Studio»: AI Planner (план в 3 шага), AI Stager (стейджинг по фото), AI Render, AI Painter, AI Moodboard, AI Planter [проверено: resources.homestyler.com V6.0].
- Кредиты: AI Designer/Styler — 10 кредитов за картинку, AI Modeler — 20; $9.99 за 200 кредитов; Pro — 180 кредитов/мес [проверено: https://checkthat.ai/brands/homestyler/pricing].
- Проверки геометрии после ИИ — не найдены [не найдено].

### 3.9 Электрика, инженерка, сметы (единственный из троих «массовых» с электрикой)

- V5.0: «circuit point configurations for lighting circuits (WL), strong and weak current socket circuits (WX), air conditioning circuits (WP-K), and high-power circuits (WP)»; «Light Control settings generate the control relationship between switches and fixtures» → «lighting control relationship diagram» при экспорте [проверено: https://www.homestyler.com/forum/view/1854685667502432257 «Plumbing and Electrical Beginner's Guide»].
- Процесс ручной: «Water and electricity settings — manual process» [проверено: https://www.homestyler.com/forum/view/1915717919653744641].
- Боль: «How to show power switches and sockets in elevation drawing?» — не показываются [проверено: https://www.homestyler.com/forum/view/1681915541695864833].
- Расчёта нагрузки, автоматов, кабеля, норм — не найдено [не найдено]. У нас — `electricplan.ts: designElectrics`, `designCsv`, замечания по ПУЭ.

### 3.10 3D, рендер, VR, AR

- 1K бесплатно с водяным знаком (снять — 9 coins), 2K $0.99, 4K $1.99 поштучно; Pro — 75 рендеров 2K/4K в месяц; Master — почти всё безлимитно кроме видео и 12K-панорам [проверено: https://checkthat.ai/brands/homestyler/pricing; https://www.homestyler.com/pricing].
- Панорама 4K, «720° virtual tour with a customized map», просмотр на VR; видео-облёт [проверено: https://www.homestyler.com/forum/view/1504684767619526658; forum V4.0.4].
- «The quota for panoramic rendering and image rendering is shared» [проверено: форум].
- Мобильное приложение: «AR Room Scan… capture your real room and auto-generate editable 3D layouts» и AR-режим примерки поверх камеры [проверено: описание в Google Play https://play.google.com/store/apps/details?id=com.autodesk.homestyler через сниппет]. Ограничения скана: «only supports new projects… does not support multi-floor scanning» [проверено: сниппет по запросу «Homestyler AR Room Scan», первоисточник в выдаче не показан — требует перепроверки]. Сам Homestyler советует «combine augmented reality scans with manual verification to ensure wall lengths… are precise» [проверено: https://pt.homestyler.com/article/accurate-room-measurement-with-homestyler].

### 3.11 Экспорт, печать, масштаб

- «EXPORT → Construction Drawing → Edit Drawing → Floor Plan → JPG/PDF/DWG»; масштаб листа выбирается внизу [проверено: https://www.homestyler.com/forum/view/1684283386266230786; forum V5.0].

### 3.12 Облако, совместная работа, версии

- Team-план; январь 2026: папки в My Space, Team Model / My Model, пакетная синхронизация моделей в Team Library [проверено: https://www.homestyler.com/about/updates].
- **История версий есть:** V5.0 — «File → Version History», выбрать версию → «Open» → редактировать; V4.0 — «Open My Designs → More → View Historical Versions» [проверено: https://www.homestyler.com/forum/view/1486236784633729025]. Тем не менее темы «my project just got deleted!!!! can i recover it???», «All my models disappeared», «Project recovery» — регулярные [проверено: https://www.homestyler.com/forum/view/1636891335610695682; /1714778835917840386; /1795433853717688322].

### 3.13 Мобильное приложение

- Официально: приложение — «quick design work… on the go», веб — «more complete and full-featured»; Pro/Master «designed for the web version» [проверено: https://www.homestyler.com/room-design-app].
- Боли: «glitch, glitch, crash, won't load, crash, freeze, deletes hours of work…»; «wanted to work on plans from their iPad, but all it will do is upload the current picture… there is no where to make edits» [проверено: App Store через https://justuseapp.com/en/app/601137449/homestyler-interior-design/reviews].
- Русские отзывы: «непонятная программа, требующая много времени на разбор; делает только расстановку мебели и не может подбирать цвет стен»; «на компьютерах с низкими графическими возможностями программа сильно отстаёт»; «приложение неимоверно глючит, каждый раз какая-то проблема» [проверено: сниппеты https://partnerkin.com/services/homestyler; https://vraki.net/otzyvy/mobilnye-prilozheniya/homestyler-dizayn-interera.html; https://otzovik.com/review_1745268.html; ветка https://4pda.to/forum/index.php?showtopic=490052].

### 3.14 Онбординг, обучение, шаблоны

- «Beginner's Guide»: 5 частей интерфейса (canvas, catalog, toolbars, property panel) + шорткаты [проверено: https://www.homestyler.com/beginnerguide]; «1,000+ ready-to-use room templates» [проверено: homestyler.com]; «200+ design challenges per year» с призами-подписками [проверено: https://www.homestyler.com/challenge].

### 3.15 Free и цена

- Styler $3.90, Pro $4.90–6.80, Master $9.90–11.80, Team $19.60/место (разброс между источниками и датами) [проверено: https://www.homestyler.com/pricing; checkthat; saasworthy] [противоречие по цифрам].
- Боль: «charges users after signing up for a free trial and it is impossible to cancel» [проверено: App Store через justuseapp]; «layers subscriptions, AI credits, coin systems, and à la carte render purchases in ways that can catch you off guard» [проверено: checkthat].

### 3.16 Сильные стороны Homestyler

- Ввод длины при рисовании + ортогональный режим + толщина сверху — быстрый ввод по размерам.
- Электрика с группами и связью выключатель→светильник, чертежи розеток/выключателей.
- Чертежи в масштабе (PDF/DWG) с выбором annotation scale.
- Бесплатные 1K-рендеры без лимита (с водяным знаком).

---

## 4. Coohom

### 4.1 Распознавание плана

- Вход: DWG/DXF (только из AutoCAD, стены в две линии шириной 50–400 мм), JPG/PNG/PDF; «uploaded images should have clear and visible elements… if blurry, it will not be possible to recognize key information like lines and dimensions» [проверено: https://www.coohom.com/helpcenter/how-to-upload-import-autocad-file; https://www.coohom.com/helpcenter/requirements-for-uploading-copy-images-to-generate-floor-plans].
- Результат: «AI identifies walls, rooms, doors, and windows… editable»; «15–45 seconds»; после — инструмент «Adjust Walls» [проверено: https://www.coohom.com/case/ai-floor-planner; https://villaviz.com/brands/coohom/ai — третье лицо, «85–90% accuracy» не подтверждено первоисточником].
- Масштаб: помощь не описывает чтение подписей; по статье — «make sure your sketch has clear wall lines and room labels» [проверено: coohom article]. Лимиты на распознавание для Free — не найдены [не найдено].

### 4.2 Рисование стен (Cloud Design 5.0)

- «Press the **space bar** to switch between the internal, center, and external location lines of the wall» во время рисования; «pressing the **Shift** key… the wall can only be drawn along the X/Y axis» [проверено: https://www.coohom.com/us/helpcenter/coohom-cloud-design-5-0-wall-drawing-function-summary-quickly-draw-floor-plan]. **Alt** во время рисования — быстрое переключение толщины стены; Tab — выбор мебели/деталей, не длины [проверено: https://www.coohom.com/helpcenter/coohom-shortcuts]. Ввод длины с клавиатуры **во время** рисования (как у Homestyler и у нас, `PlannerCanvas.tsx:999–1022`) в help-центре не описан — есть «wall length box» после [не найдено; сниппет https://www.coohom.com/helpcenter/floor-plan-design-basics].
- Привязка к сетке, автоматические размеры при рисовании, «prevents… overlapping walls» [проверено: https://villaviz.com/brands/coohom/floor-planner — третье лицо].
- Арочная стена «outer curve and inner straight line» [проверено: https://www.coohom.com/en_US/helpcenter/article/cloud-design-5-0-how-to-draw-an-arch-wall-...].

### 4.3 Правка стен и комнат (лучший образец)

- **Длина:** «select the wall… click on the dimension line for length annotation to activate the input field, enter the dimensions, **choose the wall's direction of extension**, then press Enter» [проверено: https://www.coohom.com/helpcenter/floor-plan-adjust-wall-size].
- **Split / Merge / Align:** отдельная статья; выравнивание «inner, center, or outer edges of selected walls» [проверено: https://www.coohom.com/us/helpcenter/floor-plan-wall-editing-tips-split,-merge,-and-align].
- **Dimension Lock:** «fix a wall length before adjusting neighbors», соседние стены «adjust proportionally» [проверено: https://www.coohom.com/article/how-to-make-a-specific-wall-size-floor-planner — статья Coohom, не help-центр].
- Тип стены (несущая/перегородка), высота отдельной стены в 3D [проверено: https://www.coohom.com/helpcenter/how-to-modify-my-wall-type; .../floor-plan-adjust-individual-wall-height]; низкие стены и колонны — отдельная статья Cloud Design 5.0 [проверено: https://www.coohom.com/us/helpcenter/cloud-design-5-0-how-to-adjust-wall-height,-draw-low-walls-and-columns].
- **Замок структур:** выделить одну или несколько стен (Shift) → «Lock» во всплывающем окне; «once locked, they cannot be moved or deleted»; снять — иконка замка в нижней панели, галочками по типам структур [проверено: https://www.coohom.com/helpcenter/how-to-lock-my-floorplan]. Из троих это ближе всего к нашему `locked` на стене.

### 4.4 Размеры и единицы

- Preferences: «millimeters, meters, fractional inches, decimal inches, feet w/ fractional inches, feet w/ decimal inches» — **сантиметров нет** [проверено: https://www.coohom.com/helpcenter/floor-plan-change-the-unit-of-measurement-in-preferences]. Для РФ, где БТИ пишет метры с двумя знаками, а дизайнеры работают в мм, это неудобно; у нас `LengthUnit = 'cm' | 'mm' | 'm'` (`types.ts:238`).
- Размерная линия у стены редактируемая (см. 4.3) — размер и есть поле ввода.

### 4.5 Двери, окна

- «click on the door style… then click on a wall… the door snaps to the wall and creates an opening automatically. You can drag the door along the wall»; справа: width, height, thickness, distance above the ground [проверено: https://www.coohom.com/helpcenter/kitchen-closet-add-doors-windows-to-the-floor-plan; https://www.coohom.com/article/design-room].
- Параметрические проёмы, гнутые окна для арочных стен [проверено: helpcenter parametric-door-opening-structure; doors-windows-design-design-custom-curved-windows].

### 4.6 Каталог

- «300,000+ models» (описание приложения) / «1,000,000+» (сравнения) [противоречие: https://apps.apple.com/us/app/coohom-interior-home-design/id1621093551 vs https://www.spacesbydee.com/...]; 273 модели выключателей/розеток [проверено: https://www.coohom.com/3d-models/Switches-and-Sockets].

### 4.7 Отделка

- Материалы, параметрические потолки, «hard decoration» [проверено: https://www.coohom.com/helpcenter/ceiling-design-quick-placement-of-the-finished-or-parametric-ceilings].

### 4.8 ИИ-функции

- **AI Furnish**: выбрать комнату → «AI Furnish» → стиль (Modern, Scandinavian, Industrial…) → комната наполняется «appropriately sized and positioned furniture» [проверено: villaviz — третье лицо; https://www.coohom.com/case/ai-home-design].
- **AI Instant**: выбрать весь этаж или комнаты → стиль → расстановка сразу в 3D [проверено: https://blog.coohom.com/...ciff-shanghai-2026/].
- «Design Your Home by Chatting with AI» — чат-интерфейс [проверено: https://www.coohom.com/case/ai-home-design].
- Проверка геометрией/эргономикой — не найдена [не найдено].

### 4.9 Электрика, инженерка, сметы

- Автогенерация комплекта строительных чертежей; «Drawings Layout» собирает виды в рамку листа; экспорт «CAD, PDF, JPG, and Mix» [проверено: https://www.coohom.com/helpcenter/what-can-i-export-download; https://support.coohom.com/en/articles/3548143-generate-cad-floor-plans-construction-drawings].
- Электрика: символы розеток/выключателей/светильников на плане, чертёж электрики как вид [проверено: https://www.coohom.com/case/construction-drawings]. Групп щита/расчёта нагрузок — не найдено [не найдено].
- Смета: «checkout list of all products for client estimates»; в Kitchen & Bath / Custom Furniture — «quotation list in DOCX, XLSX, or PDF» [проверено: App Store описание; https://www.coohom.com/helpcenter/what-can-i-export-download].

### 4.10 3D, рендер, VR, AR

- Панорамы до 16K, 360-walkthrough, видео [проверено: https://www.coohom.com/helpcenter/render-360%C2%B0-walkthrough-rendering-guide].
- Free: 1K с водяным знаком, 3 проекта, «5–10 renders per month» (третье лицо) [проверено: https://villaviz.com/brands/coohom/pricing; https://www.capterra.com/p/192882/Coohom/pricing/].
- Боль: «free plan having free renders but not being able to even look at them or download them» [проверено: G2/Capterra через сниппет]; «moved… watermark-free 1K renders behind the Pro paywall» [проверено: https://www.meltflexai.com/blog/coohom-ai-interior-design-review].

### 4.11 Экспорт

- См. 4.9: CAD/PDF/JPG/Mix, слои упорядочены [проверено: what-can-i-export-download].

### 4.12 Облако, совместная работа

- Workspace → Projects → Collaborate; ссылка с правами view / duplicate / edit; срок «permanent, 30 days, 7 days, or 24 hours»; пароль [проверено: https://www.coohom.com/helpcenter/share-project-links-with-others-set-validity-and-password].
- **История версий есть:** «File → restore history» показывает предыдущие версии проекта, любую можно открыть [проверено: https://www.coohom.com/helpcenter/how-to-recover-the-deleted-missing-design-of-a-certain-project]; удалённый целиком проект восстанавливает саппорт по письму за «1–2 working days» [проверено: https://www.coohom.com/us/helpcenter/how-to-recover-the-deleted-project].

### 4.13 Мобильные приложения

- Android «Coohom AI – 3D Home Design», iOS «Coohom Interior Home Design» [проверено: Google Play / App Store]. Боль: «Coohom can't work with their latest updated version on Android, including tablets and the browsers» [проверено: ProductHunt/G2 через сниппет]; «performance can be slow when handling complex designs» [проверено: там же]; Google Play, 9 марта 2026: «Doesn't even deserve a star… It asks for login… even after logging in» [проверено: https://play.google.com/store/apps/details?id=com.coohom.capp через сниппет].

### 4.14 Онбординг, шаблоны

- «4 Ways to Create a New Project»: с нуля / шаблон / загрузка плана / **поиск готовой планировки в библиотеке** («Search Floor Plans») [проверено: https://www.coohom.com/helpcenter/4-ways-to-create-a-new-project-in-coohom; https://www.coohom.com/helpcenter/floor-plan-search-floor-plan]. В Kujiale это база реальных ЖК [по памяти].

### 4.15 Free и цена

- Pro ≈ $29/мес ($300/год), Professional ≈ $79/мес, Enterprise — по запросу [проверено: capterra pricing; villaviz; firstchair — третьи лица].
- Своя статья Coohom обещает, что Free «allows unlimited layout creation and PDF export» [проверено: https://www.coohom.com/article/best-free-ai-floor-plan-generators — самореклама]; лимит именно на распознавание картинки для Free — не найден [не найдено].
- Боли: «auto-renewal… $453 credit-card invoice after a cancellation that did not take» [проверено: Trustpilot/Capterra через сниппет]; саппорт «unhelpful, disrespectful, and unresponsive» [проверено: partnerkin/G2].

### 4.16 Сильные стороны Coohom

- Точная правка: редактируемая размерная линия + направление роста + замок размера + опорная линия внутри/ось/снаружи + выравнивание граней.
- Полный комплект чертежей с рамкой и экспорт в CAD.
- Ссылка на проект с правами, сроком и паролем.
- Единицы под инженерный стандарт (мм) — но без см.

---

## 5. Матрица по категориям

| Категория | Planner 5D | Homestyler | Coohom | Мы (`/home/user/3d`) |
|---|---|---|---|---|
| Рисование стен | Pencil, формы комнат; ввода длины при рисовании не найдено | Ввод длины при рисовании + Enter; толщина и орто-режим сверху | То же + пробел: внутри/ось/снаружи; Shift — орто | Точки/прямоугольник, ввод длины при рисовании (по оси), привязки 0/45/90, Т-стыки, сетка |
| Правка стен/комнат | Split→drag→hide; тянуть стену/угол; поле Length внизу; Lock Walls на весь проект | Split/merge/align/arc в 2D; Full/Partial; галочка Unlock Walls | Щелчок по размеру → ввод → направление; Dimension Lock; выравнивание граней; замок на выбранные структуры | Прямая целиком, тянуть поперёк, Alt — участок, Del участка, замок, склейка, «разрыв — Ctrl+Z» (`walledit.ts`) |
| Размеры/единицы | Metric/imperial, рулетка (2D), цвет стрелок | mm/cm/m/ft; скрыть площади/длины; annotation scale | mm/m/дюймы/футы (без см); размерная линия = поле ввода | см/мм/м; длина по оси/внутри/снаружи; размерные линии привязаны к граням (`dims.ts`) |
| Двери/окна | Drag на стену, прилипание к ближайшей (жалобы), направление открывания | Drag, hinge-баг | Клик по стилю → клик по стене; параметрические | Прилипают к стене, сектор открывания |
| Каталог | 8–10 тыс., Free ограничен | 1 млн+, coins | 300 тыс.–1 млн, бренды | ~60 + Poly Haven CC0 + свой GLB |
| Отделка | Текстуры/цвет, часть платно | Материалы, часть убрана | Материалы, параметрические потолки | Полы по комнатам, 6 типов (`types.ts:139 FloorKey`); цвета/материала стен нет |
| ИИ | Smart Wizard (6 форм, стиль, несколько вариантов), Design Generator (фото→6 рендеров) | AI Planner, Stager, Render, Painter, Moodboard; кредиты | AI Furnish, AI Instant, чат | Распознавание по подписям, ИИ-расстановка с проверкой геометрией и эргономикой |
| Электрика/инженерка/сметы | Нет; Budget Calculator по стране | Группы WL/WX/WP-K/WP, связь выкл→свет, чертежи; вручную | Символы, чертёж, quotation list | Группы щита, автоматы, кабель, ПУЭ-замечания, CSV ведомость (`electricplan.ts`) |
| 3D/рендер/VR/AR | Draft free; 4K/360 Pro; AR iOS; Vision Pro | 1K free, 2K/4K платно; 720° тур; VR | 16K панорамы; 1K free с ВЗ | 3D, «Фото 3D», AR через телефон |
| Экспорт/DXF/PDF | DWG/DXF только Pro, 2D; PDF — печать браузера без масштаба | PDF/JPG/DWG с масштабом | CAD/PDF/JPG/Mix, комплект листов | PNG/SVG/JSON (`exporters.ts:16–29`), CSV электрики; без масштаба и рамки |
| Облако/совместно/версии | Live co-editing, роли; версий не найдено | Team, папки; File → Version History | Ссылка с правами/сроком/паролем; File → restore history | Автосохранение в localStorage (один ключ), Ctrl+Z в сессии, ссылка для телефона (`share.ts`); версий нет |
| Мобильные | 4 платформы; крэши, пейволлы | Урезанное приложение; крэши | Приложения; проблемы на Android | Веб + Telegram Mini App |
| Онбординг/шаблоны | +Create: пусто/шаблон/план/ИИ | Beginner's guide, 1000+ шаблонов, челленджи | 4 пути, поиск планировок | Стартовый экран с 4 входами, 3 шаблона (`templates.ts`) |
| Free/цена | ~$20/$50 мес; Trustpilot 2.5 | $4–12/мес + кредиты + coins | $29/$79/мес | Бесплатно |

---

## 6. Что из этого стоит взять нам и почему

Оценки: польза — высокая/средняя/низкая; цена — календарные дни одного разработчика с тестами.

1. **Щелчок по числу длины стены → поле ввода → стрелка «в какую сторону расти» (Coohom).** Сейчас длина прямой правится в панели свойств (`walledit.ts: setRunLength`, `setRunLengthBy`), а по числу — только у стороны комнаты (`setRoomSide:535`). Сделать единый приём для любой подписи длины на чертеже (стена, сторона комнаты, размерная линия), с двумя кнопками-стрелками у поля. Это самый частый вопрос новичков во всех трёх help-центрах. **Польза: высокая. Цена: 2–3 дня.**

2. **Пробел переключает опорную линию при рисовании: внутри / ось / снаружи (Coohom).** У нас ввод длины при рисовании — «по оси», а «в чистоте» — только потом щелчком. Планы БТИ дают именно размеры в чистоте, значит рисовать по внутренней грани — естественно. Показать текущую опору у курсора рядом с «234 см · Enter». **Польза: высокая. Цена: 2–3 дня** (нужно вести смещение при повороте и на углах).

3. **Несколько вариантов ИИ-расстановки с превью и оценкой (Smart Wizard).** Planner 5D генерирует «несколько layouts» и даёт выбрать; у нас `furnish.ts:100 furnish()` возвращает один `FurnishReport`. Сделать 3 варианта (разный сид/стиль), в карточках — миниатюра и число замечаний из `checks.ts`; выбор применяется, остальные отбрасываются. **Польза: высокая. Цена: 3–4 дня.**

4. **Чертёж в масштабе с рамкой: PDF 1:50 / 1:100, A4/A3, штамп с именем и площадями (Homestyler «annotation scale», Coohom «Drawings Layout»).** Наш экспорт — PNG/SVG без масштаба (`exporters`, `PlannerPage.tsx:3306`). Для сдачи прорабу и для сверки с техпаспортом нужен именно лист в масштабе. SVG уже есть — добавить рамку, масштаб, легенду, генерацию PDF (svg2pdf/jsPDF). **Польза: высокая. Цена: 3–4 дня.**

5. **Отдельные листы электрики: розетки, выключатели/свет, щит (Homestyler «Construction Drawings → switches / sockets»; Coohom electrical view).** У нас есть режим «Электрика» и CSV; добавить экспорт тех же листов по слоям с легендой и высотами точек. **Польза: средняя (высокая для тех, кто нанимает электрика). Цена: 1–2 дня поверх п. 4.**

6. **Связь «выключатель → светильник» и группы света (Homestyler «Light Control»).** У нас точки уже имеют группу щита (`electricplan.ts`); добавить явную связь выключателя со светильниками (проходные — два выключателя на одну группу), рисовать пунктир на плане, включать в CSV и в замечания («светильник без выключателя», «выключатель ничем не управляет»). **Польза: средняя-высокая. Цена: 3 дня.**

7. **Выбор страниц из многостраничного PDF (Planner 5D).** Техпаспорт БТИ часто присылают PDF на 3–6 страниц. Сейчас вход — картинка (`underlay.ts`). Рендерить страницы pdf.js в миниатюры, дать выбрать план-страницу, дальше — наш конвейер. **Польза: средняя. Цена: 2 дня.**

8. **Полустены / высота одной стены (Homestyler Full/Partial, Coohom per-wall height).** Барные стойки, перегородки до 1,2 м, подиумы — типичная перепланировка. В `types.ts` у стены нет высоты; добавить поле, отрисовку в 3D (`Scene.tsx`) и штриховку на плане. **Польза: средняя. Цена: 2 дня.**

9. **Замок и привязки — показывать, а не прятать (анти-боли Planner 5D «snapping… resets once you exit the project» и Homestyler «impossible to change the wall dimensions» из-за скрытой галочки Unlock Walls).** У нас настройки уже переживают перезагрузку: `PlannerPage.tsx:377` пишет `{ layers, unit, ortho, wallThickness, mode, wallRef }` в localStorage, шаг сетки живёт в самом плане (`plan.settings.grid`, `PlannerPage.tsx:3241`). Остаётся два шага: (а) у курсора показывать, к чему сейчас прилипаем — конец / ось / грань / сетка, как уже делает инструмент «Размер» (README: «кружок у курсора»); (б) при попытке сдвинуть зафиксированную стену (`touchesLocked`) показывать подсказку «стена заперта — снять замок» с кнопкой прямо в ней, а не молча не двигать. **Польза: средняя. Цена: 1 день.**

10. **Список покупок с размерами и ссылкой на поиск (Planner 5D «Find Furniture», Coohom «checkout list»).** У нас есть ведомость электрики (`designCsv`). Сделать такую же по мебели: предмет, Ш×Г×В, комната, количество, ссылка вида «поиск на маркетплейсе по названию и размеру». Без бэкенда — просто ссылки. **Польза: средняя. Цена: 1–2 дня.**

11. **Шаблоны типовых российских планировок (Coohom «Search Floor Plans», Planner 5D templates).** Сейчас три шаблона (`templates.ts: studio / one-room / two-room`). Добавить 6–8 узнаваемых: хрущёвка 1/2/3к, П-44 1/2к, брежневка 2к, студия новостройки — с размерами в чистоте из открытых типовых серий. Это же — тест-набор для распознавания. **Польза: средняя-высокая для РФ. Цена: 0,5 дня на шаблон, 3–4 дня всего.**

12. **Снимки версий проекта (Homestyler «File → Version History», Coohom «File → restore history»).** У двух из троих история версий есть, у Planner 5D не найдена, а «deletes hours of work» — сквозная жалоба на все три мобильных приложения. У нас — только Ctrl+Z внутри сессии (`store.ts:34 usePlanHistory`) и один ключ localStorage `boop.planner.plan.v1` (`PlannerPage.tsx:356`): любая ошибка после перезагрузки страницы необратима. Добавить снимки (авто — перед «Распознать стены», «Расставить», «Электрика → Расставить» и каждые N правок; вручную — «Сохранить версию») со списком, миниатюрой и восстановлением; хранить в IndexedDB, чтобы вместе с подложкой не упереться в лимит localStorage. **Польза: средняя-высокая. Цена: 2 дня.**

13. **Флип петли и стороны открывания прямо на чертеже (анти-боль Homestyler «doors opening from the handle side»).** Кнопка «Петли с другой стороны» у нас уже есть, но в панели свойств (`PlannerPage.tsx:2255`), а сторона открывания (`Opening.side`, `types.ts:30`) правится отдельно. Сделать: ручка на секторе открывания — тянешь её на другую сторону стены или к другому косяку, сектор перепрыгивает; горячая клавиша F по выделенной двери; в `checks.ts` — «дверь бьёт в другую дверь» и «дверь открывается на проход уже 70 см». **Польза: средняя. Цена: 1 день.**

14. **Импорт DXF (Planner 5D принимает DXF; Coohom/Homestyler — DWG/DXF с двухлинейными стенами).** Для тех, у кого уже есть обмер от дизайнера. Парсер LINE/LWPOLYLINE → пары параллельных отрезков → стены через существующий `normalizeWalls`. **Польза: низкая-средняя для массового пользователя. Цена: 4–6 дней.** Делать после пп. 1–12.

15. **Не брать:** парадигму «split → drag → hide» Planner 5D для ниш и перегородок (наш Alt+тянуть участок `pushRun(plan, id, offset, part)` и Alt+щелчок+Del уже проще); асинхронное распознавание «до 24 часов с письмом»; монетизацию через coins/кредиты/водяные знаки — именно она даёт 2.5 на Trustpilot.

### Что у нас уже сильнее лидеров (не трогать, а показывать в онбординге)

- Распознавание по подписям размеров и площадей с отчётом «на сколько сошлось» (`planai.ts: scaleFromLabels`, `fitResultToLabels`; диалог «Распознано») — ни у кого из троих нет.
- Правка стен «прямая целиком, тянуть поперёк, соседи едут следом, комната не размыкается» + замок (`walledit.ts: pushRun`, `guardLocks`) — ровно то, на что жалуются пользователи Planner 5D.
- Размер в чистоте как в техпаспорте с выбором опоры (`walledit.ts: refLength`) и размерные линии, привязанные к граням (`dims.ts: dimSnap`, `followDims`).
- Электрика как проект с группами, автоматами, кабелем и нормами (`electricplan.ts: designElectrics`) — у Homestyler только ручные группы, у Coohom и Planner 5D — ничего.
- Проверка расстановки геометрией и эргономикой (`checks.ts:100 runChecks`, `furnish.ts:100`) после ИИ — у конкурентов ИИ-расстановка без проверки.

---

## Приложение: источники (основные)

Planner 5D help: https://support.planner5d.com/en/articles/14434484-how-to-upload-a-floor-plan · /7458952-using-upload-a-plan-feature · /7210615-how-to-resize-a-room · /5876845-changing-dimensions-web · /15701690-how-to-change-wall-thickness · /5876834-adding-corners-web · /15934552-how-to-create-partition-walls · /7459522-deleting-part-of-the-wall-ios · /8123706-unsplitting-the-wall-ios · /6579117-changing-metrics-unit-other-dimensions-settings-web · /5876799-measuring-the-distance-using-a-ruler-web · /12906280-how-to-add-windows-android · /6117935-smart-wizard · /7218617-design-generator-ios · /9564673-budget-calculator-for-your-project · /10581383-360-walkthrough-feature · /7244303-ar-try-on-tool-ios · /9582739-export-projects-in-dwg-or-dxf-formats · /15116256-how-to-share-projects · /13038612-how-to-create-a-new-project · /15128965-planner-5d-subscription-types
Planner 5D отзывы: https://www.trustpilot.com/review/planner5d.com · https://www.capterra.com/p/164022/Planner-5D/reviews/ · https://checkthat.ai/brands/planner-5d/reviews · https://justuseapp.com/en/app/606173978/planner-5d-interior-design/reviews · https://a2is.ru/catalog/programmy-dlya-stroitelstva-i-remonta/planner-5d/reviews-planner-5d · https://www.techradar.com/reviews/planner-5d
Homestyler: https://www.homestyler.com/forum/view/1486264945836707841 (стены) · /1635960405562134529 (CAD двухлинейные) · /1854685667502432257 (электрика) · /1915717919653744641 · /1681915541695864833 · /1865818123191263234 (двери) · /1394726942529441793 (единицы) · /1708528443315822594 · /1640998543632289794 (V5.0 чертежи) · /1684283386266230786 (экспорт) · /1486164437042106370 (Full/Partial) · https://www.homestyler.com/about/updates · https://resources.homestyler.com/2026/04/14/... · https://www.homestyler.com/article/mastering-ai-floor-plan-conversion · https://www.homestyler.com/article/trends/create-accurate-floor-plans-from-photos · https://www.homestyler.com/room-design-app · https://www.homestyler.com/pricing · https://checkthat.ai/brands/homestyler/pricing · https://justuseapp.com/en/app/601137449/homestyler-interior-design/reviews · https://partnerkin.com/services/homestyler/reviews · https://www.homestyler.com/about/story
Добавлено вторым проходом (замки, версии, PDF, привязки): https://support.planner5d.com/en/articles/13042256-how-to-lock-rooms-and-hide-objects-android · /12978550-how-to-lock-rooms-and-hide-objects-in-your-project-ios · /8015457-how-to-unlock-objects-in-windows-app · /13044756-how-to-align-objects-android · /15859960-how-to-rotate-items · /5876838-printing-projects · https://planner5d.com/blog/upgrade-to-planner-5d-premium/ · https://interiorindex.org/tool-reviews/planner-5d-review/ · https://vraki.net/otzyvy/mobilnye-prilozheniya/planner-5d-planirovshchik-domov-i-interera.html · https://www.homestyler.com/forum/view/1486236784633729025 (Version History) · /1494589724393631746 · /1563082204886441985 · /1607296553112801281 (Unlock Walls) · /1509950612570583042 · /1636891335610695682 · https://pt.homestyler.com/article/accurate-room-measurement-with-homestyler · https://play.google.com/store/apps/details?id=com.autodesk.homestyler · https://www.remodelai.io/blog/best-free-ai-floor-plan-apps · https://sourceforge.net/software/product/Homestyler/ · https://www.coohom.com/helpcenter/how-to-lock-my-floorplan · https://www.coohom.com/helpcenter/coohom-shortcuts · https://www.coohom.com/us/helpcenter/cloud-design-5-0-how-to-adjust-wall-height,-draw-low-walls-and-columns · https://www.coohom.com/helpcenter/how-to-recover-the-deleted-missing-design-of-a-certain-project · https://www.coohom.com/us/helpcenter/how-to-recover-the-deleted-project · https://www.coohom.com/article/best-free-ai-floor-plan-generators · https://play.google.com/store/apps/details?id=com.coohom.capp
Coohom: https://www.coohom.com/us/helpcenter/coohom-cloud-design-5-0-wall-drawing-function-summary-quickly-draw-floor-plan · https://www.coohom.com/helpcenter/floor-plan-adjust-wall-size · https://www.coohom.com/us/helpcenter/floor-plan-wall-editing-tips-split,-merge,-and-align · https://www.coohom.com/helpcenter/floor-plan-change-the-unit-of-measurement-in-preferences · https://www.coohom.com/helpcenter/how-to-upload-import-autocad-file · https://www.coohom.com/helpcenter/requirements-for-uploading-copy-images-to-generate-floor-plans · https://www.coohom.com/helpcenter/kitchen-closet-add-doors-windows-to-the-floor-plan · https://www.coohom.com/helpcenter/what-can-i-export-download · https://support.coohom.com/en/articles/3548143-generate-cad-floor-plans-construction-drawings · https://www.coohom.com/helpcenter/share-project-links-with-others-set-validity-and-password · https://www.coohom.com/helpcenter/4-ways-to-create-a-new-project-in-coohom · https://www.coohom.com/helpcenter/floor-plan-search-floor-plan · https://www.coohom.com/article/how-to-make-a-specific-wall-size-floor-planner · https://www.capterra.com/p/192882/Coohom/reviews/ · https://www.trustpilot.com/review/coohom.com · https://www.g2.com/products/coohom/reviews · https://partnerkin.com/services/coohom/reviews · https://villaviz.com/brands/coohom/ai · https://www.meltflexai.com/blog/coohom-ai-interior-design-review · https://en.wikipedia.org/wiki/Manycore_Tech
