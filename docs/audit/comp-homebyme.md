# Ритейл и каталоги: HomeByMe, IKEA Kreativ, IKEA Kitchen Planner (+ старый Home Planner, PAX/BESTÅ)

Дата: 2026-09-26. Метод: WebSearch (англ. + рус.), сниппеты help-центров (homebyme.zendesk.com, homebyme.supporthero.io, ikea.com/…/customer-service/knowledge, support.home-design.ikea.com), обзоры, Trustpilot/Capterra/App Store через агрегаторы, форумы Houzz, Т—Ж, Otzovik. WebFetch к homebyme.zendesk.com, homebyme.supporthero.io, ikea.com, techradar.com, inspiredkitchendesign.com — **заблокирован прокси** (EGRESS_BLOCKED), поэтому все цитаты — из поисковых сниппетов, а не из полного текста страниц; где сниппет мог быть урезан, это отмечено.

Метки: **[проверено: ссылка]** — факт виден в сниппете названной страницы; **[по памяти]** — знание без свежего подтверждения; **[противоречие]** — источники расходятся; **[предположение]** — моя интерпретация; **[не найдено]** — искал, не нашёл.

Наш продукт для сравнения: `/home/user/3d` (README.md; `src/planner/catalog.ts`, `walledit.ts`, `dims.ts`, `snapping.ts`, `checks.ts`, `share.ts`, `exporters.ts`, `products.ts`, `electricplan.ts`, `FurnishDialog.tsx`, `templates.ts`, `PlannerPage.tsx`).

---

## 0. Резюме

1. **Три продукта — три разные модели «каталог → покупка».** HomeByMe (Dassault Systèmes) — универсальный планировщик с брендовым каталогом («20 000+» / «30 000+» [противоречие]) и рендер-фермой; IKEA Kreativ — визуализация в своей комнате (скан → стирание мебели → расстановка IKEA-товаров → корзина); IKEA Kitchen Planner — конфигуратор модульной кухни по правилам с автоматической сметой и печатью «Summary + Items list». Ни один не читает размеры с чертежа БТИ и не проверяет расстановку эргономикой — это остаётся нашей нишей.
2. **Лучший приём правки стен — у HomeByMe: «Apply left / Apply right».** Щёлкнул по стене → на каждой стороне появляется её длина → щёлкнул по числу → ввёл → выбрал, какой конец двигать [проверено: https://homebyme.zendesk.com/hc/en-us/articles/35277650380829]. У нас `setRunLength` всегда двигает конец `b` (`walledit.ts:457-458`), выбор конца есть только для стороны комнаты (`setRoomSide … end: 'a'|'b'`, `walledit.ts:535`). Переносится за 1–2 дня.
3. **Кухня по модулям у IKEA — это не рисование, а конфигурирование:** «поднеси к стене — повернётся, поднеси к соседнему шкафу — примагнитится» [проверено: сниппет Dendra Doors/ikeahackers], «Modify» на каждом модуле (фасады, наполнение, ручки, цвет корпуса, боковые панели), автоматический «filler piece» в узкий зазор с выключателем на модуле [проверено: https://plum-living.com/eu/media/practice/ikea-user-guide], столешница отдельным товаром. Смета считается сама, но неполно: боковые декоративные панели и филлеры «не добавляются автоматически» (там же), «планировщик не учитывает филлер, чтобы дверцы у стены открывались» [проверено: House Digest]. То есть даже у эталона «смета из каталога» боль — **что в ней забыто**.
4. **Шаринг у IKEA — «код проекта», и он меняется при каждой правке** («If you make any changes… your design code will change… save your new code every time») [проверено: https://www.ikea.com/cz/en/customer-service/knowledge/articles/bd38g1b8-18f3-4f33-b98g-1848045e8768.html]. У HomeByMe — ссылка/соцсети/QR-код для телефона/публикация в сообщество [проверено: https://home.by.me/en/tutorials/how-to-share-your-project/]. Наш `share.ts` (план сжат в хэше URL) ближе к IKEA-коду по идее «ссылка = состояние», но без QR и без короткого кода.
5. **Kreativ — сильный сценарий «в моей комнате», слабый инструмент планировки.** Скан ~2 мин + ~5 мин обработки [проверено: AOL/Real Simple]; после «Hide All / Show All» нет отмены — «users are forced to save the unwanted changes» [проверено: https://www.ixd.prattsi.org/2024/02/design-critique-ikea-kreativ-ios-app/]; изменить размеры комнаты после создания — «coming soon» [проверено: help-центр IKEA US]; предметы нельзя масштабировать [проверено]. Это не конкурент нашему 2D-редактору, а образец **онбординга через фото** и **корзины из плана**.
6. **Что ругают везде одинаково:** потеря работы (HomeByMe «project was not saved despite showing as saved», IKEA «crashing while trying to save… would delete designs entirely»), тормоза и крэши (HomeByMe Trustpilot 2.6/5 при 67 отзывах [проверено: https://www.trustpilot.com/review/home.by.me]; IKEA «laggy, glitchy, buggy, slow as molasses»), неотключаемая привязка (HomeByMe «snapping… cannot be turned off»; IKEA «the auto-snap thing will make you want to break something»), предупреждения на то, что инструмент сам расставил (IKEA).
7. **Новый IKEA 3D-планировщик кухни (октябрь 2025)** меняет модель онбординга: не «с нуля», а «возьми одну из популярных кухонь в фотореалистичном 3D и персонализируй под бюджет; цена пересчитывается в реальном времени; кухню можно отсканировать iPhone» [проверено: https://www.ingka.com/newsroom/the-new-ikea-3d-kitchen-planning-experience-brings-1-75-million-design-projects-to-life-each-year/]. Это подтверждает направление «шаблон + живая цена», а не «пустой лист».
8. **Чего нет у нас и есть у них:** живая смета из каталога с итогом и печатью (IKEA), QR/короткая ссылка для телефона (HomeByMe/IKEA), «восстановить проект после краха браузера» (HomeByMe Recover), редактируемые расстояния от предмета до стен (HomeByMe «Position»), кухонный ряд как единый объект со столешницей и авто-филлером (IKEA/HomeByMe Enterprise), 2D-чертёж в PDF (HomeByMe — только Pro), LiDAR-скан комнаты (HomeByMe app, Kreativ), стирание мебели на фото (Kreativ).

---

## 1. Кто есть кто (уточнение к вводной)

- **HomeByMe** — Dassault Systèmes (бренд 3DVIA → HomeByMe) [проверено: https://enterprise-home.by.me/frequently-asked-questions/ «developed by Dassault Systèmes»]. Две ветки: потребительский home.by.me (веб + iOS/Android) и HomeByMe Enterprise (белые планировщики кухонь/ванных/шкафов для ритейлеров: Castorama, Leroy Merlin и др. [проверено: там же]). Потребительские тарифы: Starter 0 $ (2 проекта, 5 Full HD рендеров, скриншоты без лимита), Premium ≈ 29–32 $/мес, Unlimited+ ≈ 65–72 $/мес [проверено: https://www.g2.com/products/homebyme/pricing; https://www.firstchair.app/blog/homebyme-review]. «HomeByMe recently reduced free project limits, which has frustrated existing users» [проверено: firstchair]; раньше было 5 проектов [по памяти].
- **IKEA Kreativ** — технология Geomagical Labs (Кремниевая долина), куплена Ingka Group в апреле 2020 [проверено: https://techcrunch.com/2020/04/02/ikea-acquires-ai-imaging-startup-geomagical-labs-to-supercharge-room-visualisations]; запуск июнь 2022 в США, iOS + веб [проверено: https://techcrunch.com/2022/06/22/ikea-rolls-out-an-ai-powered-interactive-design-experience-for-shoppers/]; сейчас «в приложении IKEA на iOS или Android, или на IKEA.com» [проверено: https://www.ikea.com/gb/en/customer-service/knowledge/articles/0fc5ee6d-20g9-4c54-8b17-deb68gccc467.html]; Австрия — апрель 2024 [проверено: https://retailtechinnovationhub.com/home/2024/4/2/…]. Бесплатно.
- **IKEA Kitchen Planner** (kitchen.planner.ikea.com; METOD в Европе, SEKTION в Северной Америке, ENHET/KNOXHULT — отдельные конфигураторы). Старый **IKEA Home Planner** — десктопный плагин 2020 Technologies («2020PluginInstaller», Windows XP+) [проверено: сниппет https://m.ikea.com/ms/en_AA/customer_service/kitchen_bathroom_laundry_services/home_planner.html]; заменён веб-планировщиком: «IKEA has replaced the IKEA Home Planner with the New Kitchen Planner. Your designs are safe… assistance… to migrate» [проверено: сниппет https://www.ikea.com/ph/en/planners/]. В России IKEA не работает с 2022 г., русскоязычные отзывы — 2015–2021 гг.
- **Новый 3D-планировщик кухни (2025)** — в приложении IKEA и на вебе, 17 стран на октябрь 2025 (Испания, Чехия, Венгрия, Словакия, Португалия, Корея, Дания, Финляндия, Норвегия, Хорватия, Румыния, Сербия, Словения, Италия, Австралия, Канада, Япония) [проверено: https://retailtechinnovationhub.com/home/2025/10/22/ikea-takes-wraps-off-3d-kitchen-planning-experience-now-live-in-17-countries-including-spain]. Кто разработчик (Geomagical/Kreativ-движок или сторонний) — [не найдено].

---

## 2. HomeByMe

### 2.1 Рисование стен

- **Только в 2D.** «All drawing tools require 2D view to work. To switch to 2D view, use the "2D" button located at the bottom of your screen» [проверено: https://homebyme.zendesk.com/hc/en-us/articles/35277650380829]. Путь: открыть проект → 2D → кнопка «Build» в левом тулбаре → «2D Plan» (последняя кнопка); Esc отменяет текущее рисование [проверено: сниппет zendesk «Create your space in 3D»].
- **Комната из формы.** «How to create a room»: выбрать форму комнаты и её назначение, затем менять форму «selecting a wall and dragging»; «make sure not to leave any space for windows and doors, as the openings will be created automatically when you place them» [проверено: https://homebyme.supporthero.io/article/show/169182-how-to-create-a-room]. Ввод размеров при создании комнаты — пользователи просят: «add room measurements, not just area, when creating a room» [проверено: App Store через https://justuseapp.com/en/app/1465715066/homebyme/reviews].
- Ввод длины с клавиатуры во время рисования — [не найдено]; длина правится после (2.2).
- Горячие клавиши: Ctrl+S, Ctrl+Z/Ctrl+Y, Ctrl+C/V, Esc — снять выделение, двойной клик — добавить предмет с аксессуарами в выделение, Ctrl+drag — рамка выделения; при постановке из каталога **пробел поворачивает на 90°** [проверено: https://homebyme.supporthero.io/article/show/154216-all-keyboard-shortcuts]. Ортогональность/45° при рисовании — [не найдено].
- **Привязка:** статья «How Snapping Works» есть [проверено: https://homebyme.supporthero.io/article/show/114951-how-snapping-works — содержание в сниппет не попало], а в отзывах: «the snapping effect can be a bit finicky and annoying and it cannot be turned off» [проверено: Software Advice/Capterra https://www.softwareadvice.com/space-management/homebyme-profile/]. В сравнение: у нас привязки к концам, осям, Т-стыкам, сетке, 0/45/90° (README:14; `snapping.ts:33` виды `endpoint|wall|align|grid|free`).

### 2.2 Правка стен и комнат (особое внимание)

**Что происходит при щелчке по стене:** появляются размеры — «wall length (one dimension on each side)» [проверено: zendesk 35277650380829]. То есть две длины — по каждой грани, не по оси. Это близко к нашему «размер в чистоте», но без выбора базы.

**Как задаётся длина (лучший приём):**
1. «Click on the measurement you want to change. Enter the new measurement.»
2. «To confirm, you need to choose between "Apply left" and "Apply right" (or "Apply up" and "Apply down" depending on your case). Choosing one of these buttons lets you decide which side of the wall the length change will affect» [проверено: там же; также https://homebyme.supporthero.io/article/show/114374-how-to-change-the-wall-length-to-a-precise-value].
У нас: `setRunLength` — «конец b уходит на нужное место (поперечная стена за ним — вместе с ним)» (`walledit.ts:457-458`), выбор конца есть только у `setRoomSide(plan, a, b, length, end)` (`walledit.ts:535`).

**Как двигают:** «select a wall, hold your click and drag it to reposition it, and the new dimensions of your room are recalculated automatically»; «drag the wall corner to reposition it» [проверено: https://homebyme.zendesk.com/hc/en-us/articles/35277673120797]. Двигается ли стена только поперёк (как у нас `pushRun`) или свободно — из сниппета не ясно [не найдено]. В 3D стены не правятся: «inability to adjust walls in 3D mode viewing» [проверено: Software Advice].

**Разбить стену:** «Select a wall, click the "Split" action in the action bar that appears below your cursor, and the wall is divided into multiple segments that you can manipulate independently. You can also apply a different material to each wall section» [проверено: zendesk 35277673120797]. Панель действий — **под курсором** (action bar), не сбоку.

**Удалить стену:** «identify the wall… click on delete and click on 3D to check» [проверено: https://home.by.me/en/tutorials/how-to-delete-a-wall/].

**Толщина / высота / кривые / скошенные:**
- толщина — на каждую стену отдельно [проверено: https://homebyme.supporthero.io/article/show/114499-working-with-walls-of-different-thickness];
- понизить стену (полустена) — через Edit, «available for all the interior walls» [проверено: https://homebyme.supporthero.io/article/show/115136-how-to-lower-a-wall];
- кривая стена: «click on the first wall, hold down Ctrl/Cmd, and select the second wall. A curved wall icon will appear at the junction. Click it» [проверено: https://homebyme.supporthero.io/article/show/114389-how-to-create-curved-walls];
- скосы (мансарда): «Only outward-facing walls can benefit from this feature» [проверено: https://homebyme.supporthero.io/article/show/170470-how-to-create-and-use-sloped-walls].
- Есть статья «7 easy steps to solve all 3D wall problems» [проверено: https://homebyme.supporthero.io/article/show/28925-…] — сам факт такой статьи говорит, что стены — постоянный источник обращений.

**Замок стен:** [не найдено]. У нас — на одну (`types.ts` `locked`) и на все.

**Что ругают (дословно):**
- «it is extremely confusing and it is practically impossible to make walls… one of the worst websites I have ever used» [проверено: Trustpilot через сниппет https://www.trustpilot.com/review/home.by.me].
- «trying to move room edges to the exact measurements wanted is seriously frustrating» [проверено: App Store через justuseapp].
- «it is difficult to add/change wall placement. However, in 2D, it's a simple matter of selecting your wall and dragging it» [проверено: Capterra https://www.capterra.com/p/163482/Homebyme/reviews/].
- «can only view one floor at a time in the house you build» [проверено: Software Advice].
- Русский обзор: «Начальная подготовка требует времени — нужно вводить размеры комнат точно, измерив пространство; интерфейс имеет кривую обучения» [проверено: https://dtf.ru/software/5021467-homebyme-3d-planirivschik-interera].

### 2.3 Размеры и единицы

- Единицы: «mm, cm, or ft» в настройках [проверено: zendesk 35277650380829; https://homebyme.zendesk.com/hc/en-us/articles/35277672162973]. Отзыв: «Imperial measurements would be nice» [проверено: Capterra] — видимо, о частичной поддержке футов-дюймов.
- **Размеры вокруг предмета — редактируемые.** «Click on a piece of furniture… In the action bar (below the cursor), click the "Position" button (ruler icon) and dimensions around the furniture appear directly on your plan. These distances can be edited: click on a distance to change its value and move your object with the greatest precision» [проверено: zendesk 35277650380829]. У нас: магнит к стене и выравнивание по соседям (`snapping.ts:213`, `:261`), размерные линии `dims.ts` — но ввод расстояния «от шкафа до стены = 15 см» с перемещением предмета — [предположение: нет].
- Показ всех размеров: «Settings» внизу → панель справа → вкладка «Display» [проверено: там же]. Скриншот с параметрами: площади комнат, имена, размеры [проверено: https://homebyme.supporthero.io/article/show/88223-how-to-view-add-and-print-with-measurements].
- Площадь комнаты: отдельный туториал «How to find area measurements» [проверено: https://home.by.me/en/tutorials/how-to-find-area-measurements-in-your-3d-home/]. Площадь считается по внутренним граням или по осям — [не найдено].

### 2.4 Двери, окна, проёмы

- Каталог (иконка книги) → «Doors & Windows» → разделы (interior doors, front doors, windows, sliding glass doors…) → щёлкнуть предмет → щёлкнуть по стене [проверено: https://homebyme.zendesk.com/hc/en-us/articles/35277636490909].
- Панель свойств (карандаш → панель справа): «dimensions, position height from the floor, **position in wall by dragging a slider** to move it toward the interior or exterior, and **wall side** to choose the opening direction» [проверено: там же]. Слайдер «положение в толще стены» — приём, которого у нас нет (у нас side/hinge — `templates.ts:26`).
- Проём без двери: «Doors & Windows» → «Wall openings» [проверено: https://homebyme.zendesk.com/hc/en-us/articles/35277658612381]. «Open door» — отдельная статья [проверено: https://homebyme.supporthero.io/article/show/115909-how-to-create-an-open-door].
- Привязка окна к стене при перетаскивании: [по памяти — прилипает к ближайшей стене]; жалоб на «прыгающие окна», как у Planner 5D, в сниппетах не встретил [не найдено].

### 2.5 Каталог мебели и техники (ключевое отличие HomeByMe)

- Число: «more than 20,000 products» [проверено: https://a2is.ru/catalog/servisy-dlya-dizajna-interera/homebyme; https://en.androidguias.com/apps-decorate-home/] vs «brand catalog of over 30,000 products» [проверено: App Store https://apps.apple.com/us/app/homebyme-house-planner-3d/id1465715066] [противоречие — вероятно, рост за годы].
- Бренды: Maisons du Monde, Westwing, Urban Outfitters, Cole & Son [проверено: androidguias]; партнёрская страница Maisons du Monde: «starting from a readymade design by Maisons du Monde or creating your own» [проверено: https://home.by.me/en/partner/maisonsdumonde]. Упоминания IKEA/Target/Pier 1 в каталоге [проверено: androidguias — вторичный источник, возможно устарело].
- **Список покупок:** «you can view your shopping list or the dimensions of your project while you're at the store» [проверено: сниппет androidguias / home.by.me/mobile-application]. Но: «you cannot purchase the furniture you see directly through the software» [проверено: firstchair] — ссылки на магазин, не корзина.
- Боль каталога: «Items shown don't even look like what the picture shows when you put it down»; «having to open up the decor tab then to the kitchen… then to the kitchen cabinets is so much work for one cabinet to be placed» [проверено: App Store через justuseapp] — глубина навигации в каталоге.
- Свои модели: импорт 3D-моделей и «MakeByMe» (создание мебели) — в Pro [проверено: https://home.by.me/en/pro-features/].
- Сравнение с нами: у нас ~60 предметов (README:18) + «товар по ссылке» с ценой и габаритами (README:26; `products.ts:172 fetchProduct`, `types.ts:127 price`) + Poly Haven (README:24). Наш путь «вставь ссылку на товар» решает ту же задачу «реальный товар в плане» без 30 000 моделей, но не даёт «полистать бренд».

### 2.6 Кухня в HomeByMe (модули)

- Потребительская версия: Каталог → «Kitchen Cabinets» → «Customizable Cabinets»; четыре типа: base, wall, high, corner; «cabinet can be adjusted to specific widths (for example, 60 cm wide) and drawers can be resized to match»; фасады/фурнитура выбираются; **столешница добавляется отдельно** из «Work tops and accessories» [проверено: https://homebyme.supporthero.io/article/show/114798-how-to-create-custom-kitchen-cabinet]. Правил стыковки модулей/автозаполнения ряда в потребительской версии — [не найдено].
- Enterprise Kitchen Planner (то, что стоит у ритейлеров): «any base, corner or high cabinet placed… comes with a worktop. This worktop can be modified… via the Edit panel of the cabinet: choose another worktop, switch top to bottom side in case of reversible worktops, define cut-outs» [проверено: http://kitchen-doc.by.me/docs/planner/use-planner/behavior/behavior_worktops/]; «over 150 business rules… error-free and compliant designs»; «algorithm automatically generates kitchen layout proposals and highlights errors and design constraints»; автопредложения по «kitchen layout, refrigerator placement, and sink positioning» [проверено: https://enterprise-home.by.me/smart-kitchen-planner/; https://enterprise-home.by.me/resource/key-features-homebyme-kitchen-planner/]; функция copy-paste в кухонном планировщике — отдельный релиз [проверено: https://enterprise-home.by.me/resource/kitchen-planner-copy-paste-function/].
- Вывод: «кухня по правилам» у Dassault — это B2B-продукт с бизнес-правилами ритейлера; потребителю достаются настраиваемые шкафы без проверки. Наш `catalog.ts:275-344` (тумбы 60/80/100, угловой, мойка, плита, холодильник, ПММ, пенал, остров) с `hint` и `clearance` ближе к «правилам», чем потребительский HomeByMe, но без столешницы и ряда как объекта.

### 2.7 Отделка

- Материалы стен/полов — «How can I customize the walls and floors» [проверено: https://homebyme.supporthero.io/article/show/176630-…]; разные материалы на сегментах одной стены (после Split) и на частях пола («divide a room and apply different floor materials») [проверено: https://homebyme.zendesk.com/hc/en-us/articles/35277662359453]. Бренды покрытий (Cole & Son) в каталоге [проверено: androidguias].

### 2.8 ИИ-функции

- **AutoDesign & Magic Furnish** — «AI-driven automatic furnishing and layout generation… produce several possible room or kitchen configurations in seconds»; «Auto Furnish now uses semantic search» [проверено: https://enterprise-home.by.me/resource/homebyme-ai-solutions/; https://zoftwarehub.com/products/homebyme/overview]. В App Store: «thanks to the AutoDesign feature, you can furnish a room using images from the community» [проверено: App Store]. Проверка результата геометрией/эргономикой — [не найдено]. У нас — `furnish.ts` + `checks.ts` (README:20).
- **Room Scanner** (мобильное приложение): LiDAR, «only available on iPhone 12 Pro and above», «3D room plan in seconds», «with or without existing furniture», «appears in both 2D and 3D with accurate dimensions» [проверено: https://enterprise-home.by.me/resource/room-scanner-homebyme/; App Store]. Точность в цифрах — [не найдено].
- Распознавание плана с картинки — нет: импорт только как подложка (2.10).

### 2.9 Электрика / инженерка / сметы

- Электрики как проекта — [не найдено; по памяти — только светильники и розетки как декор].
- Смета: «shopping list» из каталога (2.5); итоговая цена проекта — [не найдено в сниппетах]. Ведомости материалов/кабеля нет.

### 2.10 Импорт плана, экспорт, печать, DXF/PDF

- **Импорт:** PNG/JPG/PDF как подложка; «to scale the plan… find a wall or any element whose size you know»; «change the scale by placing 2 points and typing the right measure in the box»; правка через «Edit» (карандаш) → панель справа: opacity, orientation [проверено: https://homebyme.zendesk.com/hc/en-us/articles/35277672456093; https://home.by.me/en/tutorials/how-to-import-a-floor-plan/]. Это ровно наша «Калибровать» (README:16) — без распознавания стен.
- **2D-чертёж:** «2D Plan studio… detailed, professional floor plan… with all the measurements»; «The option to generate a 2D floor plan is available with the Pro plan. Alternatively… save them as JPG… then converted to a PDF» [проверено: https://homebyme.supporthero.io/article/show/173909-how-to-generate-a-2d-plan-of-my-project; https://home.by.me/en/pro-features/]. Статья «How to print a PDF» [проверено: https://homebyme.supporthero.io/article/show/115110-how-to-print-a-pdf].
- **DWG/DXF:** «get professional DWG/DXF 2D drawings… by exporting your 3D project to DraftSight» [проверено: home.by.me/pro-features; https://help.solidworks.com/2019/English/DraftSight/DraftSightSW/HLPID_HOMEBYME.htm] — через второй продукт Dassault, не прямой экспорт.
- «exporting to other consumer design apps is limited… you may need to screenshot or recreate the layout manually» [проверено: firstchair].
- У нас: JSON/CSV/SVG/PNG (`exporters.ts:16-29`; `PlannerPage.tsx:3306-3307`), PDF нет.

### 2.11 3D, рендер, VR, AR

- Рендеры: Small/HD/360/видео через «world wide render queue» на серверах [проверено: https://home.by.me/en/services/create-360-image/; …/get-hd-realistic-videos/]. Free — 5 Full HD; 4K и 360 — по кредитам в Premium; водяной знак снимается в Unlimited+ [проверено: G2/firstchair].
- Боли: «low-res photorealistic images take ages to render» [проверено: TechRadar через сниппет https://www.techradar.com/reviews/homebyme]; «3D pan can make some objects temporarily disappear» [проверено: там же]; баг экспорта видео висел с декабря 2024 по январь 2025 — 30 дней [проверено: justuseapp].
- AR: «AR Preview lets you see products at true scale right in your home… before adding them to your project» (мобильное приложение) [проверено: App Store]. AR всей планировки (как наш якорь по порогу, README:36) — [не найдено].

### 2.12 Облако, совместная работа, версии

- Проекты в облаке, только онлайн [проверено: firstchair]. **Share:** «copying the URL link of your project»; соцсети; «publish on the Homebyme community or invite to collaborate by generating a QR code to scan on a mobile device» [проверено: https://home.by.me/en/tutorials/how-to-share-your-project/; https://homebyme.supporthero.io/article/show/169329-how-to-share-a-project-on-mobile]. «the sharing option doesn't appear to work» [проверено: TechRadar].
- Дублировать проект, скопировать на другой аккаунт, **«Recover Feature» — восстановить проект, когда «the browser crashes, or an issue occurs in saving»** [проверено: https://homebyme.supporthero.io/article/show/133476-…; http://home-doc.enterprise.by.me/docs/planner/use-planner/recover_project.html]. История версий — [не найдено]. Pro: read-only режим проекта, запрет дублирования, приватные модели, портфолио 3DStory [проверено: home.by.me/pro-features].

### 2.13 Мобильные приложения

- iOS/Android: «edit them live», AR Preview, Room Scanner, 4K, видео-тур, сообщество «over 5 million users» [проверено: App Store; https://home.by.me/en/mobile-application/].
- Отзывы: «crashes frequently and keeps freezing… unable to add furniture»; «after spending a couple of days on a project, it stopped saving»; «spent 2 days designing only to discover their project was not saved despite showing as "saved"»; «loading bars that freeze at the last step» [проверено: justuseapp reviews/problems].

### 2.14 Онбординг, обучение, шаблоны

- Старт с формы комнаты (2.1) или с готового проекта партнёра (Maisons du Monde) [проверено]. Гайды «How to design home layouts», «How to layout a bedroom» на сайте [проверено: https://home.by.me/en/guide/…]. «users expected to spend 30 to 60 minutes creating a single room design» [проверено: firstchair]. Русской локализации нет [проверено: a2is].

### 2.15 Free и цена

- Starter: 2 проекта, 5 Full HD, скриншоты без лимита; Premium ≈ 29–32 $/мес; Unlimited+ ≈ 65–72 $/мес [проверено: G2/firstchair]. Trustpilot 2.6/5 (67 отзывов), ответ на 54 % негативных, «typically taking over 1 month to reply» [проверено: trustpilot]. «refused a refund even though they could no longer use the product» [проверено: Capterra].

### 2.16 Сильные стороны HomeByMe

1. «Apply left / Apply right» — однозначный ввод длины стены с выбором конца (2.2).
2. Редактируемые расстояния вокруг предмета («Position») — точная постановка мебели числом (2.3).
3. Слайдер положения окна/двери в толще стены + выбор стороны открывания (2.4).
4. Брендовый каталог с реальными товарами и список покупок (2.5); ready-made проекты партнёров как старт.
5. Recover после краха браузера, дублирование, QR для телефона (2.12).
6. Профессиональный рендер-конвейер (HD/4K/360/видео) — то, чего мы делать не собираемся.

---

## 3. IKEA Kreativ

### 3.1 Что это и как устроен вход

- Бесплатный «virtual room designer» внутри приложения IKEA и на ikea.com/…/home-design; два входа: **свой скан** (только в приложении) и **галерея 50+ шоурумов** / «Build a room» (веб и приложение) [проверено: https://www.ikea.com/gb/en/customer-service/knowledge/articles/0fc5ee6d-20g9-4c54-8b17-deb68gccc467.html; https://www.ingka.com/newsroom/ikea-launches-new-ai-powered-experience-empowering-customers-to-create-lifelike-room-designs/].
- «scan their whole room (LiDAR-enabled devices only) to build it in 3D. On the web, users can use the room builder to manually enter their room's dimensions instead» [проверено: сниппет ikea.com/us/en/home-design].

### 3.2 Скан комнаты (Scene Scanner)

- Два типа: **Photographic Wide-Angle Scan** (панорама из фото) и **Full Room Scan** (LiDAR, «digital twin», комната стартует пустой) [проверено: https://www.ikea.com/be/en/customer-service/knowledge/articles/8ca21219-9032-405c-92b4-408da0b4e6c0.html]. «The app automatically selects the best scanning method for your device, whether it's 5 Point Panoramic, Ultrawide, or 1-Scan LiDAR» [проверено: сниппет help-центра IKEA].
- Как снимать: «get the widest view of the room… standing back with the device centered, then directing the camera left to right by pivoting with wrists, capturing the room in five spots» [проверено: https://www.aol.com/lifestyle/designed-living-room-ikeas-ai-180929085.html]. Время: «scan a room took about two minutes, and then… another five minutes to prepare and upload» [проверено: там же].
- Результат: «wide-angle, interactive replica of the space, with accurate dimensions and perspective» [проверено: Ingka]. Цифры точности — [не найдено]. Без LiDAR работает, но «having it allows the app to pull in additional spatial detail» [проверено: сниппет Engadget/9to5mac].
- Android: нужен ARCore + Google Play Services for AR; «Detailed Viewpoint Scan feature is not available on certain devices due to hardware limitations» [проверено: https://support.home-design.ikea.com/hc/en-us/articles/360039289854-Will-the-app-work-on-my-smartphone]. Веб: нужен WebGL с аппаратным рендером [проверено: https://support.home-design.ikea.com/hc/en-us/articles/360052559294-…].
- Ошибка обработки: «could not access the computing resources normally relied on for fast processing and better visual realism» [проверено: сниппет support.home-design.ikea.com] — обработка серверная.

### 3.3 Стирание мебели (Erase)

- Для Wide-Angle Scan: «use the top toggle to switch to "Erase Items" and clicking on any item outlined in yellow to remove it. Alternatively, "Hide All"… or "Show All"» [проверено: ikea.com/be article 8ca21219]. Для Full Room Scan комната всегда пустая.
- Критика (Pratt, по Норману): «Colored outlines around different objects, as well as the color differentiation between deleted objects and kept objects, served as good signifiers»; но «After users tap "Hide All" or "Show All", they are not provided with any options other than saving the changes. Users are unable to recover from this action, and they are forced to save the unwanted changes» [проверено: https://www.ixd.prattsi.org/2024/02/design-critique-ikea-kreativ-ios-app/]. Агрегатор обзоров: «does not provide measurement tools or undo/redo options, and the scanning feature… users encountering errors and unable to continue, with no explanation of what went wrong» [проверено: https://www.toolworthy.ai/tool/ikea-home-design — вторичный источник].

### 3.4 «Build a room» (веб/приложение) — рисование и правка стен

- Шаги: «1. Click the Build a room card 2. Choose your room shape 3. Adjust your dimensions by clicking and dragging the walls to resize them 4. Add doors and windows 5. Choose your room's wall color and floor style 6. Click Design this room» [проверено: https://www.ikea.com/us/en/customer-service/knowledge/articles/9f1ad433-a13a-43b0-bec3-68e75682e8a2.html].
- Ввод точных размеров: «You can input your room's exact dimensions to create a floor plan… Products are automatically scaled based on your provided measurements» [проверено: https://www.ikea.com/us/en/customer-service/knowledge/articles/9141b674-4cg8-494g-8c12-1cf3e9c5b41f.html].
- **Правка после создания — нет:** «Editing room dimensions after the room is created is coming soon!» [проверено: там же]. Масштаб предметов — нельзя: «Products within a showroom cannot be resized. If a sofa looks too large… it's a sign that it might be too large for your space in reality» [проверено: там же]. Это не редактор планировки, а «конструктор сцены».

### 3.5 Размеры

- «view product and room dimensions: product dimensions (length, width, and height), **product spacing (distance between products and walls)**, and room dimensions (wall lengths in 3D rooms)» [проверено: https://www.ikea.com/us/en/customer-service/knowledge/articles/d353aa22-f10b-43c3-8282-6234045432df.html]. Расстояния до стен показываются, но (по 3.3) не редактируются числом.

### 3.6 Каталог, кухня, отделка

- Только каталог IKEA; «swapping, moving, rotating, stacking, and hanging IKEA products» [проверено: Ingka]. «You can design some wall and ceiling mounted furniture… such as curtain rods and pendant lamps, as well as kitchen cabinets» [проверено: https://support.home-design.ikea.com/hc/en-be/articles/360038999793-What-can-I-design-in-my-space]. Кухня в Kreativ — расстановка шкафов как предметов, без модульных правил [предположение по сниппету].
- Отделка: цвет стен и пол в «Build a room» [проверено: 3.4]; в скане — [не найдено].

### 3.7 ИИ

- «AI-powered»: сегментация и удаление объектов, реконструкция геометрии из фото (Geomagical) [проверено: Ingka/TechCrunch]. Автоматической расстановки мебели — [не найдено]; в 2025 у IKEA появился отдельный ИИ-ассистент для покупок в приложении [проверено: заголовок https://www.ingka.com/newsroom/ikea-reinvents-home-shopping-with-smart-new-app-features/ — содержание не проверено].

### 3.8 Смета и покупка

- «IKEA Kreativ automatically adds everything right to your IKEA shopping cart» [проверено: сниппет Narcity/Apartment Therapy]; «add products to their cart, save their design ideas to their IKEA account… share design ideas with family and friends» [проверено: Ingka]. Дублирование дизайна для вариантов [проверено: сниппет help-центра].

### 3.9 3D / AR

- Скан-сцена — 3D-реплика с перспективой; отдельно AR «View in the room» на карточке товара: «object fixed in the center… gray out effect… still in preparation and unclickable»; проблема: «Users might stand too close to the model and pass through it… no signifier to indicate what actions are possible to fix it» [проверено: Pratt].

### 3.10 Шаринг, облако, мобильность

- Сохранение в аккаунт IKEA, шаринг ссылкой [проверено: Ingka]; веб ↔ приложение: «scan… using the mobile app, then design and refine… on either your phone… or your computer» [проверено: сниппет help-центра].

### 3.11 Онбординг

- Вход через галерею «50+ inspirational 3D showrooms» — «если не хотите тратить время на сканирование» [проверено: https://www.ixbt.com/news/2022/06/22/…; Ingka]. Это сильный приём: пользователь сначала играет в готовой комнате, а не рисует.

### 3.12 Free / цена / доступность

- Бесплатно; ограничение — страны (США 2022 → Европа/Австралия/Канада 2023–2024) [проверено: retailtechinnovationhub; ikea.au campaign]. В России недоступен (уход IKEA в 2022).

### 3.13 Что ругают

- Нет отмены в стирании (Pratt); скан падает без объяснений (toolworthy); обработка на сервере — «processing issues» [проверено: support.home-design.ikea.com]; iOS-only на старте [проверено: https://techzle.com/review-ikea-kreativ-design-your-interior; 4pda/ixbt 2022]; размеры комнаты после создания не поправить [проверено: 3.4]; «a few glitches» в бете [проверено: AOL].

### 3.14 Сильные стороны Kreativ

1. Скан + стирание существующей мебели — единственный из троих, кто убирает шаг «освободи комнату» [проверено: Ingka «no need to move anything around before scanning»].
2. Галерея готовых комнат как нулевой шаг онбординга.
3. «Всё в корзину» — план сразу становится покупкой.
4. Product spacing — расстояние до стен показывается по умолчанию.

---

## 4. IKEA Kitchen Planner (METOD/SEKTION), старый Home Planner, новый 3D-планировщик 2025, PAX/BESTÅ

### 4.1 Онбординг и ввод комнаты

- «press 'Start designing'. The first time you will be asked to define **oven location, extractor hood type, fridge/freezer preference and layout type**» [проверено: сниппет https://www.ikea.com/us/en/customer-service/knowledge/articles/g612cd5b-fb1e-47ff-9339-496e024g5d4b.html]. Затем «pick a room shape similar to yours… typing in the overall measurements of the space»; либо «Design from scratch», либо «existing design suggestions» [проверено: https://www.ikea.com/us/en/customer-service/knowledge/articles/42b5fc4f-4ccc-4fca-94f9-00fe5b4bb336.html].
- Порядок: размеры комнаты → двери и окна → «fixtures like plumbing and gas pipes, electricity, and heating and ventilation» → шкафы (base, wall, high) [проверено: https://www.housedigest.com/1632701/how-use-ikea-kitchen-planner-tips-home-design/]. Инженерные точки (вода/газ/электрика/вентиляция) — часть ввода комнаты; это редкость для потребительского планировщика.
- «browser-based tool that isn't compatible with mobile devices» [проверено: House Digest]. Высота потолка «defaults to 100 inches» [проверено: сниппет https://dendradoor.com/how-to-use-the-ikea-kitchen-planner-2023/]. Что мерить: «height of the room… length of each wall… width and height of windows with trim, their distance from the ceiling and floor, and distance to the nearest corner» [проверено: House Digest].
- Русский опыт: «на экране было много кнопок и вкладок. Разобрались с интерфейсом примерно через пару часов» [проверено: сниппет https://t-j.ru/kitchenplanner-ikea/]; «ожидали, что программа позволит набрать шкафы, введя свои размеры стен и проёма, но ничего такого не нашли» [проверено: там же].

### 4.2 Стены, размеры, проёмы

- Стены — только как стороны выбранной формы с числовыми длинами; произвольного рисования нет [проверено по 4.1; подтверждение свободного рисования — не найдено]. Жалоба: «it's tricky to change room size with walls moving on their own accord» [проверено: сниппет обзора в выдаче по «reddit r/IKEA kitchen planner» — источник в сниппете не назван, помечаю как вторичный].
- Окна/двери задаются размерами и отступами от угла/пола [проверено: House Digest].

### 4.3 Модули: постановка, привязка, конфигурирование (особое внимание)

- **Постановка:** «click the cross arrows to move the cabinet – move towards the wall to turn, move close to another cabinet to see it snap into place» [проверено: сниппет ikeahackers.net/2016/04/metod-makeover-installation.html]. То есть ориентация модуля определяется стеной, стык — соседом.
- **Обход привязки:** «if you click on the cabinet and hold it until it turns green, then you can place it wherever you want, even if it intersects with an object» [проверено: Houzz https://www.houzz.com/discussions/2860243/does-ikea-kitchen-planner-actually-work]. Оценка: «the auto-snap thing will make you want to break something» [проверено: там же].
- **Modify** на модуле: фасады (doors/drawer fronts), наполнение (drawers, organizers, pull-outs), ручки; «when you click on "MORE," you get the option to change the interior cabinet colour as well as additional side panels» [проверено: сниппеты thelearnerobserver / dendradoor]. «To customize… click on the item and then click Modify» [проверено: plum-living user guide].
- **Filler piece:** «The kitchen planner will automatically fill in small spaces next to base and wall cabinets with a cover panel. You can turn these off for each cabinet by selecting the cabinet, clicking Modify, then turning off the "Filler piece" toggle» [проверено: https://plum-living.com/eu/media/practice/ikea-user-guide].
- **Зависимые позиции:** «Removing the doors from your Ikea plan will automatically remove hinges from your list too, and similarly, removing plinths will remove Metod legs» [проверено: plum-living]. Смета «знает» связи модуль → петли/ножки.
- **Своя техника:** «choose "Use Your Own" in the Appliances dropdown… you can resize the planner appliances… by clicking on the appliance and then Modify» [проверено: Dendra Doors 2023]. Чужие бренды мебели — нельзя: «IKEA Planner can only place items from the IKEA catalog — mixing in other brands isn't possible» [проверено: https://roomfit.app/blog/en/ikea-home-planner-guide/].
- **Правила и предупреждения:** «The planner keeps giving warnings that cabinets are overlapping each other, that there is not enough room around the range, etc., even though it auto-placed the items itself» [проверено: Houzz]; «The warnings and suggestions are broken and don't make sense, so users have to watch out for errors themselves» [проверено: там же]. Русские отзывы: «нельзя менять размеры и цвет, поскольку каталоги включают образцы реальных гарнитуров»; «редактирование проекта возможно в 3D-режиме» [проверено: сниппет https://www.inmyroom.ru/posts/32938-…; interior3d.su].
- **Что ругают в движении:** «the IKEA kitchen planner is just terrible at moving objects around»; «problems with being unable to rotate cabinets and appliances»; «glitchy and full of bugs» [проверено: https://inspiredkitchendesign.com/ikea-kitchen-planner/ через сниппет]. «laggy, glitchy, buggy, slow as molasses and for all intents unusable» [проверено: Houzz].

### 4.4 Смета из каталога (особое внимание)

- Итоговый документ: «item list, pricing, and front, interior, and top views of the layout. Each item lists the product name, price, quantity, and total price» [проверено: сниппеты Scribd «IKEA Kitchen Planner Summary Printout»]. Печать: «choose from several print options including: summary page, items list, or all options. You can preview your design and choose to print it or save it as a PDF» [проверено: https://www.ikea.com/us/en/customer-service/knowledge/articles/23414974-e942-4gb6-gbd9-03d1d5f1fd60.html]. Старый Home Planner печатал ещё и номера стеллажей склада [по памяти]; PAX-планировщик — «product list with warehouse locations and hole numbers for shelf placement» [проверено: сниппет https://www.noremax.com/eu/pax-wardrobe-planner/].
- **Смета неполна — главная боль:** «Cover panels needed to create sides and fillers are not automatically added by the Ikea Kitchen Planner… don't forget to add them to your order» [проверено: plum-living]; «IKEA doesn't account for filler, or extra space that will allow you to fully open your cabinets if they're against a wall» [проверено: House Digest]; «The Home Planner often leaves out key pieces or includes too many, meaning more time and money with trips back to the IKEA store» [проверено: inspiredkitchendesign]. Русский: «ошибки при выгрузке проектов из планировщика, такие как неправильно выбранный размер шкафа под мойку» [проверено: сниппет otzovik.com/review_1924914.html]. Платная услуга планировщика (США, $250 in-home) тоже ошибается: «planner made a poor suggestion to change an upper cabinet from 24″ to 21″… very noticeable difference in spacing» [проверено: https://www.thehomestud.com/ikeakitchenplanningserviceupdate/].
- Отношение к смете позитивное там, где она есть: «удобный планировщик кухни и возможность распечатать подробную смету» [проверено: otzovik]; «quotations given by interior designers… were not as detailed as those given by IKEA Kitchen Planner» [проверено: https://hellomrsalty.com/i-tried-ikea-kitchen-planner-singapore-despite-bad-reviews/].

### 4.5 Сохранение и шаринг (особое внимание)

- Сохранение привязано к аккаунту IKEA Family/e-mail: «Your saved kitchen designs are linked to your email address… log in… open the Kitchen planner… overview of all your saved designs» [проверено: https://www.ikea.com/us/en/customer-service/knowledge/articles/5c78f313-f546-4f24-a288-62d9bbc4b74e.html].
- **Код проекта:** «you will find your specific design code at the end of the page, after clicking on 'Finalise'… reopen the planning tool and continue your design at a later point»; «**If you make any changes to your existing plan, your design code will change.** You therefore need to make sure that you save your new code every time» [проверено: https://www.ikea.com/cz/en/customer-service/knowledge/articles/bd38g1b8-18f3-4f33-b98g-1848045e8768.html]. Код — GUID вида «4E9CCC6D-2B3B-4A58-B95D-30733BB11BAA» [проверено: Scribd]. То есть код = неизменяемый снимок (иммутабельная версия), а не ссылка на «живой» проект.
- **Поделиться:** «click on the share symbol and either choose to get a link to your design, or share the design and code through email… share button, located next to the print button» [проверено: https://www.ikea.com/de/en/customer-service/knowledge/articles/8d574ca0-bcb2-4bf8-b5cb-99e0027cdf48.html]; «If the design is saved on the account of a family member, please ask them to log in and share the design with you» [проверено: там же]. Совместного редактирования нет.
- Ссылку на план принимают сторонние сервисы: Plum Living «get your IKEA plan link by clicking "Share"… Plum Scanner… will then scan your plan and provide you an exact list of fronts needed» [проверено: plum-living]; есть open-source парсер планов IKEA [проверено: https://github.com/gabor7d2/IKEAKitchenPlanAnalyzer]. Экосистема вокруг «поделиться планом» — признак, что формат шаринга стал стандартом.
- **Потеря работы:** «Users experienced the most issues with crashing while trying to save their designs, and sometimes the system would delete designs entirely» [проверено: Houzz]; «losing all of the designs they were working on when upgrading to the newer kitchen planner tool» [проверено: сниппет https://ca.forum.ikea.com/t5/ask-community/new-kitchen-planning-tool-problems/m-p/51776]; статья help-центра «Why can't I save my kitchen design?» [проверено: заголовок]. «the software doesn't auto-save work» [вторичный сниппет, источник не назван].
- Браузеры: русский отзыв — «планировщик открывается в одном браузере на компьютере, но в другом браузере на ноутбуке» [проверено: otzovik].

### 4.6 3D / рендер

- 2D/3D в одном окне; «В конце планирования программа покажет 2D-чертежи и объёмную модель» [проверено: interior3d.su]. Фотореализм появился только в новом планировщике 2025 (4.8). AR — нет [не найдено].

### 4.7 Ограничения и free

- Бесплатно, без лимитов проектов [проверено: ikea.com/us/en/planners]. Ограничение — каталог только IKEA и «the planner doesn't know your home—it can't see plumbing layout, uneven walls, low ceilings, or quirky corners where doors might collide» [проверено: https://hivekitchenremodeling.com/ikea-kitchen-planner-is-not-enough/]; «cannot recommend products that detract from IKEA's profit margin» [проверено: inspiredkitchendesign].

### 4.8 Новый 3D-планировщик кухни (октябрь 2025)

- «Rather than starting from scratch, customers can now explore IKEA's most popular kitchens in realistic 3D photos and instantly personalise them to match their budget and style. As they design, **prices update in real time**… Customers can scan their kitchens using their iPhones… All designs, bookings and updates are managed in the new IKEA Family Membership Space» [проверено: Ingka newsroom; https://www.insightdiy.co.uk/news/ikea-launches-new-3d-kitchen-planner/15714.htm]. Цель — 1,75 млн проектов в год к FY26. Hands-on обзоров пока [не найдено].

### 4.9 PAX / BESTÅ (модули по правилам вне кухни)

- PAX: «first select the frame sizes and their depth and quantity… next… how exactly the inside of each frame will be arranged»; каркасы 50/75/100 см × 35/58 см [проверено: сниппеты https://www.noremax.com/eu/pax-wardrobe-planner/; https://chrislovesjulia.com/how-to-use-the-ikea-pax-wardrobe-planner-…/]. Тот же паттерн, что в кухне: сначала каркасы в размер стены, потом наполнение, потом список с местами на складе.

### 4.10 Сильные стороны IKEA-планировщиков

1. Модуль знает свои зависимости (фасад → петли, цоколь → ножки) и сам подкладывает филлер в узкий зазор — смета «живая».
2. Печать «Summary + Items list + виды спереди/сверху» одной кнопкой; код проекта как переносимый снимок.
3. Онбординг с 4 вопросов (духовка, вытяжка, холодильник, тип планировки) и шаблонов планировок; ввод инженерных точек (вода/газ/электрика/вентиляция) до расстановки.
4. Kreativ: скан + стирание + корзина; новый планировщик: «персонализируй популярную кухню, цена в реальном времени».

---

## 5. Матрица по категориям

| Категория | HomeByMe | IKEA Kreativ | IKEA Kitchen Planner (+2025) | Мы (`/home/user/3d`) |
|---|---|---|---|---|
| Рисование стен | Только 2D; форма комнаты → тянуть стены; ввод длины при рисовании не найден; Esc отмена; Space — поворот 90° | Веб: «Build a room» — форма → тянуть стены → двери/окна → цвет/пол; правка после создания «coming soon» | Форма комнаты + числовые длины сторон; свободного рисования нет | По точкам/прямоугольником, привязки к концам/осям/Т/сетке/0-45-90 (README:14; `snapping.ts:33`) |
| Правка стен/комнат | Клик → длины по обеим граням → ввести → **Apply left/right**; тянуть стену/угол; Split под курсором; толщина на стену; полустена; кривые (Ctrl-выбор двух стен); скосы | Нет (после создания) | «walls moving on their own accord» (вторичный сниппет) | Прямая целиком, тянуть поперёк, замок на стену/все; `setRunLength` двигает конец b (`walledit.ts:458`), выбор конца — только у стороны комнаты (`:535`) |
| Размеры/единицы | mm/cm/ft; **редактируемые расстояния вокруг предмета («Position»)**; Display-настройки; площади в скриншоте | Габариты, **product spacing до стен**, длины стен — только показ | Размеры комнаты, окон (с отступами), высота потолка (дефолт 100″) | см/мм/м; размеры в чистоте как в техпаспорте; размерные линии, рулетка (README:14; `dims.ts`) |
| Двери/окна/проёмы | Каталог → клик по стене; панель: размеры, высота от пола, **слайдер положения в толще**, сторона открывания; wall openings | Добавляются в Build a room | Размеры + отступы от угла/пола/потолка | Прилипают к стене, сектор открывания, side/hinge (`templates.ts:26`) |
| Каталог мебели/техники | 20 000+/30 000+ брендовых; список покупок; глубокая навигация (жалобы) | Только IKEA; swap/rotate/stack/hang; нельзя масштабировать | Только IKEA; «Use Your Own» техника с размерами; Modify: фасады/наполнение/ручки/панели | ~60 предметов + **товар по ссылке с ценой** (`products.ts:172`) + Poly Haven |
| Отделка | Материалы стен/полов, сегменты стены/пола по отдельности, бренды покрытий | Цвет стен/пол в Build a room | Фасады, столешницы, фартук [по памяти] | Полы по комнатам (`RoomMeta.floor`), цвета зон |
| ИИ | AutoDesign / Magic Furnish (несколько вариантов); Room Scanner LiDAR | Скан → 3D-реплика, стирание мебели (Geomagical) | Автопредложения планировок; 2025: скан iPhone | Распознавание плана БТИ с чтением подписей; ИИ-расстановка с проверкой геометрией (`furnish.ts`, `checks.ts`) |
| Электрика/инженерка/сметы | Нет / список покупок без итога | Корзина IKEA | **Точки воды/газа/электрики/вентиляции при вводе комнаты; смета с ценами/кол-вом/итогом; авто-филлер; зависимости фасад→петли** | Электрика как проект: группы щита, кабель, ПУЭ, CSV (`electricplan.ts:475`); сметы мебели нет |
| 3D/рендер/VR/AR | HD/4K/360/видео через очередь; AR Preview предмета; «объекты пропадают при панорамировании» | 3D-реплика с перспективой; AR «View in the room» | 2D/3D; 2025 — фотореалистичные 3D-фото | 3D-сцена, WebXR AR по порогу, USDZ Quick Look (README:30-36) |
| Экспорт/печать/DXF/PDF | 2D-чертёж — Pro; JPG→PDF; DWG/DXF через DraftSight | Нет | **Print: Summary / Items list / All → PDF** с видами | JSON/CSV/SVG/PNG (`exporters.ts`), PDF нет |
| Облако/совместная работа/версии | Облако; ссылка/соцсети/QR/сообщество; дубликат; **Recover после краха**; истории версий нет; Pro read-only | Аккаунт IKEA; ссылка; дубликат | Аккаунт Family; **код проекта = снимок (меняется при правке)**; ссылка/e-mail; терял проекты при миграции | Автосохранение в браузере; план в хэше URL (`share.ts:20-62`); undo в памяти (`store.ts:34`); версий нет |
| Мобильные | iOS/Android, редактирование, скан, AR; крэши и «не сохранилось» | Скан только в приложении; Android через ARCore | **Не для мобильных** (браузер) | Telegram Mini App, «Ссылка для телефона» (README:5, :36) |
| Онбординг/шаблоны | Форма комнаты; готовые проекты партнёров; 30–60 мин на комнату | Галерея 50+ шоурумов; Build a room; скан | 4 вопроса → шаблон планировки; 2025 — «персонализируй популярную кухню» | Пустой лист с тремя действиями (README:76); 7 шаблонов (`templates.ts`); StartDialog |
| Free/цена | 2 проекта, 5 HD; 29–32 $ / 65–72 $ в мес; Trustpilot 2.6 | Бесплатно; страны | Бесплатно; только IKEA | Бесплатно; ИИ-вызовы с дневным лимитом (README:196-206) |

---

## 6. Что из этого стоит взять нам и почему

Оценка: польза — высокая/средняя/низкая для нашей аудитории (квартира по плану БТИ, ремонт, расстановка, электрика); цена — дни одного разработчика на текущей кодовой базе.

1. **«Применить слева / справа» при вводе длины стены** (HomeByMe 2.2). Сейчас `setRunLength` всегда тянет конец `b` (`walledit.ts:457-458`), и пользователь не знает, какой угол уедет. Сделать: в поле длины — две кнопки-стрелки (или Shift+Enter) «этот конец / тот конец», по умолчанию — свободный конец или тот, что дальше от курсора; для стороны комнаты уже есть `setRoomSide(…, end)` (`:535`) — переиспользовать. Польза **высокая** (главная операция при обводке БТИ), цена **1–2 дня**.
2. **Редактируемые расстояния от предмета до стен** (HomeByMe «Position»). При выделении предмета показывать четыре размера до ближайших стен/соседей; клик по числу → ввод → предмет сдвигается. У нас есть магнит и выравнивание (`snapping.ts:213`, `:261`) и размерные линии (`dims.ts:74 addDimRef`), но не ввод отступа числом. Польза **высокая** (кухня, санузел — сантиметры решают), цена **2–3 дня**.
3. **Смета из каталога с итогом и печатью** (IKEA 4.4). У предмета уже есть `price` (`types.ts:127`) и карточка товара по ссылке (`products.ts:172`, README:26); у электрики — `designCsv` (`electricplan.ts:475`, кнопка `PlannerPage.tsx:2956`). Сделать общую вкладку «Смета»: предметы × кол-во × цена, итог, ссылки на магазин, CSV и печать. Польза **высокая** (переводит план в покупку — то, за что хвалят IKEA: «удобный планировщик… и возможность распечатать подробную смету»), цена **2–3 дня**.
4. **Живой итог в шапке** (новый IKEA 2025 «prices update in real time»): бейдж «≈ 148 000 ₽» рядом со счётчиком «Проверка»; клик открывает смету из п. 3. Польза **средняя**, цена **0,5–1 день** после п. 3.
5. **Кухонный ряд как модуль** (IKEA 4.3 + HomeByMe Enterprise worktop). Тумбы `counter-*` (`catalog.ts:283-285`) магнитить торец к торцу в ряд вдоль стены, автоматически рисовать столешницу по ряду и подсвечивать остаток < 10 см как «филлер» (у IKEA — авто-«filler piece» с выключателем на модуле). Не копировать «hold until green» — у нас уже есть свободная постановка. Польза **высокая** для сценария «кухня», цена **4–6 дней** (геометрия ряда, столешница в 2D/3D, филлер как замечание в `checks.ts`).
6. **Мастер «кухня» перед ИИ-расстановкой** (IKEA 4.1: духовка, вытяжка, холодильник, тип планировки). `FurnishDialog.tsx` сейчас — назначение + свободный текст + галочки (`:124-161`). Для кухни добавить 4 структурированных вопроса (плита газ/электро, ПММ да/нет, холодильник отдельно/встроенный, форма — прямая/угловая/П/остров) и подставлять их в промпт `furnish.ts`. Польза **средняя** (меньше переделок, лучше треугольник `checks.ts:235-254`), цена **1–2 дня**.
7. **Проверки кухни, которых IKEA даёт «наоборот»** (4.3: предупреждения на то, что сам расставил). У нас уже есть `stove-fridge` (`checks.ts:256`) и треугольник; добавить: плита у окна, мойка и плита без столешницы 60 см между, посудомойка не рядом с мойкой, дверца холодильника открывается в стену; и **автотест**: ИИ-расстановка кухни не порождает ни одного `warn` из собственных правил (антипаттерн IKEA). Польза **средняя**, цена **1–2 дня**.
8. **«Восстановить проект» после краха вкладки** (HomeByMe Recover 2.12) и снимки автосохранения. Самая массовая жалоба у обоих — «не сохранилось / удалило». У нас автосохранение в localStorage (`PlannerPage.tsx:3134`), но одна копия. Хранить последние 10 снимков с временем в IndexedDB и пункт «Проект → Восстановить версию…». Польза **высокая** (доверие), цена **1–2 дня**.
9. **QR-код и короткий код проекта в «Ссылке для телефона»** (HomeByMe QR 2.12; IKEA design code 4.5). `planShareUrl` (`share.ts:62`) даёт длинный URL с планом в хэше; добавить QR (библиотека ~10 КБ) в диалог и, когда есть сервер (`/api/ai` уже есть, README:206), короткий код `ABCD-1234` → снимок плана. Как у IKEA, код — неизменяемый снимок; правка даёт новый код. Польза **высокая** для Telegram/AR-сценария (README:36), цена **0,5 дня QR + 2–3 дня короткие коды**.
10. **Режим «только просмотр» в ссылке** (HomeByMe Pro read-only; IKEA «поделиться с семьёй»). `ShareMode` сейчас `'2d'|'3d'|'ar'` (`share.ts:53`); добавить флаг `view`, который прячет правку и показывает смету/размеры. Польза **средняя** (согласовать с семьёй/дизайнером), цена **1 день**.
11. **Печать PDF: план в масштабе + площади + смета** (IKEA «Summary / Items list / All» 4.4; у HomeByMe 2D-чертёж — только Pro). У нас SVG-экспорт есть (`PlannerPage.tsx:678`, `:3307`); добавить страницу A4/A3 с рамкой, масштабом 1:50/1:100, таблицей комнат (площади в чистоте — наш козырь) и сметой из п. 3. Польза **средняя-высокая** (прораб, электрик, продавец кухни), цена **3–4 дня**.
12. **Слайдер положения окна/двери в толще стены** (HomeByMe 2.4) — для наружных стен 40 см (README:105) важно, где стоит окно; сейчас проём лежит по оси [предположение по `Opening`]. Польза **низкая-средняя**, цена **1–2 дня**.
13. **Форма комнаты с числами при создании** (Kreativ «Build a room», IKEA «типовая форма + длины», жалоба HomeByMe «add room measurements, not just area»). У нас есть прямоугольник и 7 шаблонов; добавить формы Г/П с полями длин сторон в `StartDialog`/пустом листе (README:76). Польза **средняя** (быстрый старт без плана БТИ), цена **2 дня**.
14. **Точки воды/газа/вентиляции как объекты плана** (IKEA 4.1 — их вводят до шкафов). У электрики есть точки с высотой и причиной (README:28); добавить типы «стояк ХВС/ГВС», «канализация», «газ», «вентканал» с подсказкой «мойку — не дальше 1,5 м от стояка», и учитывать их в ИИ-расстановке кухни и в проверках. Польза **средняя**, цена **2–3 дня**.
15. **Не брать сейчас:** скан комнаты LiDAR и стирание мебели на фото (Kreativ, HomeByMe Room Scanner) — требует нативного приложения/серверной обработки, а наш вход — план БТИ, который точнее любого скана телефоном; рендер-ферма HD/4K/360 (HomeByMe) — не наш сценарий; каталог на 30 000 брендовых моделей — заменяем «товаром по ссылке» и Poly Haven. Польза для нас **низкая** при цене **недели+**.

### Что у нас уже сильнее лидеров (не трогать, а показывать в онбординге)

- **Распознавание плана БТИ с чтением подписей и отчётом «на сколько сошлось»** (README:105, :147-151) — ни HomeByMe (только подложка + 2 точки масштаба), ни IKEA (форма + числа) этого не делают.
- **Правка стен как прямой целиком с замком** (`walledit.ts`) против HomeByMe «Split → тяни куски» и IKEA «walls moving on their own».
- **Размеры в чистоте по внутренней грани** — у HomeByMe две длины по граням без выбора базы, у IKEA — длины сторон формы.
- **Проверка расстановки геометрией и эргономикой** (`checks.ts`) — у IKEA предупреждения «сломаны и не имеют смысла» (Houzz), у HomeByMe/Kreativ проверок нет.
- **Электрика с группами щита и ПУЭ** (`electricplan.ts`) — ни у кого из троих; IKEA лишь просит отметить точки.
- **Бесплатно и без аккаунта, в Telegram** — против 2 проектов у HomeByMe и обязательного аккаунта IKEA Family.

---

## Приложение: источники (основные)

HomeByMe
- https://homebyme.zendesk.com/hc/en-us/articles/35277650380829-How-do-I-display-add-and-edit-measurements — размеры, Apply left/right, Position
- https://homebyme.zendesk.com/hc/en-us/articles/35277673120797-How-do-I-modify-an-existing-room — тянуть стену/угол, Split
- https://homebyme.zendesk.com/hc/en-us/articles/35277636490909-How-do-I-add-a-door-or-window — панель двери/окна, слайдер положения
- https://homebyme.zendesk.com/hc/en-us/articles/35277658612381-How-do-I-create-an-opening-in-a-wall
- https://homebyme.zendesk.com/hc/en-us/articles/35277672456093-How-do-I-import-a-floor-plan-to-draw-my-walls-on-top-of-it
- https://homebyme.supporthero.io/article/show/169182-how-to-create-a-room
- https://homebyme.supporthero.io/article/show/154216-all-keyboard-shortcuts
- https://homebyme.supporthero.io/article/show/114951-how-snapping-works (содержание не прочитано)
- https://homebyme.supporthero.io/article/show/114389-how-to-create-curved-walls; …/115136-how-to-lower-a-wall; …/114499-working-with-walls-of-different-thickness; …/170470-how-to-create-and-use-sloped-walls
- https://homebyme.supporthero.io/article/show/114798-how-to-create-custom-kitchen-cabinet
- https://homebyme.supporthero.io/article/show/173909-how-to-generate-a-2d-plan-of-my-project; …/115110-how-to-print-a-pdf; …/88223-how-to-view-add-and-print-with-measurements
- https://homebyme.supporthero.io/article/show/133476-how-to-duplicate-a-project-to-create-a-copy; http://home-doc.enterprise.by.me/docs/planner/use-planner/recover_project.html
- https://home.by.me/en/tutorials/how-to-share-your-project/; https://homebyme.supporthero.io/article/show/169329-how-to-share-a-project-on-mobile
- https://home.by.me/en/pro-features/; https://home.by.me/en/offers/; https://www.g2.com/products/homebyme/pricing
- https://enterprise-home.by.me/smart-kitchen-planner/; https://enterprise-home.by.me/resource/homebyme-ai-solutions/; http://kitchen-doc.by.me/docs/planner/use-planner/behavior/behavior_worktops/; https://enterprise-home.by.me/resource/room-scanner-homebyme/
- https://www.trustpilot.com/review/home.by.me; https://www.capterra.com/p/163482/Homebyme/reviews/; https://www.softwareadvice.com/space-management/homebyme-profile/; https://justuseapp.com/en/app/1465715066/homebyme/reviews; https://www.techradar.com/reviews/homebyme; https://www.firstchair.app/blog/homebyme-review
- https://apps.apple.com/us/app/homebyme-house-planner-3d/id1465715066; https://a2is.ru/catalog/servisy-dlya-dizajna-interera/homebyme; https://dtf.ru/software/5021467-homebyme-3d-planirivschik-interera

IKEA Kreativ
- https://www.ingka.com/newsroom/ikea-launches-new-ai-powered-experience-empowering-customers-to-create-lifelike-room-designs/
- https://techcrunch.com/2022/06/22/ikea-rolls-out-an-ai-powered-interactive-design-experience-for-shoppers/; https://techcrunch.com/2020/04/02/ikea-acquires-ai-imaging-startup-geomagical-labs-to-supercharge-room-visualisations
- https://www.ikea.com/be/en/customer-service/knowledge/articles/8ca21219-9032-405c-92b4-408da0b4e6c0.html (Erase)
- https://www.ikea.com/us/en/customer-service/knowledge/articles/e86d70g6-3673-4306-b373-20f7cg7fd5ed.html (скан)
- https://www.ikea.com/us/en/customer-service/knowledge/articles/9f1ad433-a13a-43b0-bec3-68e75682e8a2.html (Build a room)
- https://www.ikea.com/us/en/customer-service/knowledge/articles/9141b674-4cg8-494g-8c12-1cf3e9c5b41f.html (размеры комнаты/предметов)
- https://www.ikea.com/us/en/customer-service/knowledge/articles/d353aa22-f10b-43c3-8282-6234045432df.html (product spacing)
- https://support.home-design.ikea.com/hc/en-be/articles/360038999793-What-can-I-design-in-my-space; …/360039289854-Will-the-app-work-on-my-smartphone; …/360052559294-Why-won-t-IKEA-Kreativ-work-with-my-computer-setup
- https://www.ixd.prattsi.org/2024/02/design-critique-ikea-kreativ-ios-app/; https://www.aol.com/lifestyle/designed-living-room-ikeas-ai-180929085.html; https://techzle.com/review-ikea-kreativ-design-your-interior; https://www.toolworthy.ai/tool/ikea-home-design
- https://retailtechinnovationhub.com/home/2024/4/2/more-than-just-software-this-is-a-game-changer-ikea-kreativ-3d-room-planner-goes-lives-in-austria
- https://www.ixbt.com/news/2022/06/22/novoe-prilozhenie-ikea-pozvolit-udalit-lishnjuju-mebel-iz-doma.html; https://4pda.to/2022/06/23/400938/; https://vc.ru/services/449369-…

IKEA Kitchen Planner / Home Planner / 2025
- https://www.ikea.com/us/en/customer-service/knowledge/articles/g612cd5b-fb1e-47ff-9339-496e024g5d4b.html (Start designing, 4 вопроса)
- https://www.ikea.com/us/en/customer-service/knowledge/articles/42b5fc4f-4ccc-4fca-94f9-00fe5b4bb336.html (SEKTION planner)
- https://www.ikea.com/us/en/customer-service/knowledge/articles/23414974-e942-4gb6-gbd9-03d1d5f1fd60.html (print/PDF)
- https://www.ikea.com/cz/en/customer-service/knowledge/articles/bd38g1b8-18f3-4f33-b98g-1848045e8768.html (planning code)
- https://www.ikea.com/de/en/customer-service/knowledge/articles/8d574ca0-bcb2-4bf8-b5cb-99e0027cdf48.html (share)
- https://www.ikea.com/us/en/customer-service/knowledge/articles/5c78f313-f546-4f24-a288-62d9bbc4b74e.html (saved designs)
- https://plum-living.com/eu/media/practice/ikea-user-guide (filler toggle, зависимости, панели)
- https://www.housedigest.com/1632701/how-use-ikea-kitchen-planner-tips-home-design/; https://dendradoor.com/how-to-use-the-ikea-kitchen-planner-2023/; https://ikeahackers.net/2016/04/metod-makeover-installation.html
- https://www.houzz.com/discussions/2860243/does-ikea-kitchen-planner-actually-work; https://ca.forum.ikea.com/t5/ask-community/new-kitchen-planning-tool-problems/m-p/51776
- https://inspiredkitchendesign.com/ikea-kitchen-planner/; https://hivekitchenremodeling.com/ikea-kitchen-planner-is-not-enough/; https://www.thehomestud.com/ikeakitchenplanningserviceupdate/; https://hellomrsalty.com/i-tried-ikea-kitchen-planner-singapore-despite-bad-reviews/; https://roomfit.app/blog/en/ikea-home-planner-guide/
- https://www.scribd.com/document/393161310/IKEA-Home-Planner-Printout; https://github.com/gabor7d2/IKEAKitchenPlanAnalyzer
- https://www.ingka.com/newsroom/the-new-ikea-3d-kitchen-planning-experience-brings-1-75-million-design-projects-to-life-each-year/; https://retailtechinnovationhub.com/home/2025/10/22/ikea-takes-wraps-off-3d-kitchen-planning-experience-now-live-in-17-countries-including-spain; https://www.insightdiy.co.uk/news/ikea-launches-new-3d-kitchen-planner/15714.htm
- https://m.ikea.com/ms/en_AA/customer_service/kitchen_bathroom_laundry_services/home_planner.html (старый Home Planner, 2020 plugin)
- https://t-j.ru/kitchenplanner-ikea/; https://otzovik.com/review_1924914.html; https://otzovik.com/review_4323444.html; https://www.inmyroom.ru/posts/32938-kak-rabotat-v-planirovshchike-kuhon-ikea-instrukciya-sovety; https://interior3d.su/onlajn-konstruktor-kuhni-ikea.php
- PAX: https://www.noremax.com/eu/pax-wardrobe-planner/; https://chrislovesjulia.com/how-to-use-the-ikea-pax-wardrobe-planner-our-master-closet-mood-board/
