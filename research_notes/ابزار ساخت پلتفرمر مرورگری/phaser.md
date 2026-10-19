# Phaser برای پلتفرمر دوبعدی مرورگر — بررسی در ۱۸ اکتبر ۲۰۲۶

## نسخه، وضعیت و هزینه

### Takeaway
Phaser 4 منتشر شده و در زمان بررسی، نسخهٔ 4.2.1 آخرین نسخهٔ فهرست رسمی است. خود کتابخانه رایگان و با مجوز MIT، حتی برای بازی تجاری قابل استفاده است.

### Cited Findings
- فهرست رسمی نسخه‌های Phaser 4، نسخهٔ 4.2.1 را در ۹ ژوئیهٔ ۲۰۲۶ در صدر نشان می‌دهد؛ نسخهٔ 4.0.0 در ۱۰ آوریل ۲۰۲۶ منتشر شده است. — [Phaser 4 Downloads](https://phaser.io/download/phaser4)
- صفحهٔ دانلود 4.2.1 نصب از npm و ابزار رسمی ساخت پروژه را نشان می‌دهد. — [Download Phaser v4.2.1](https://phaser.io/download/release/v4.2.1)
- Phaser تحت MIT منتشر می‌شود و استفادهٔ تجاری، تغییر کد و انتشار بازی بدون پرداخت به سازندهٔ Phaser مجاز است. — [Phaser License](https://phaser.io/download/license)

### Inferences
- برای پروژهٔ تازه، نسخهٔ 4.2.1 نقطهٔ شروع معقول‌تری از آموزش‌های قدیمی Phaser 3 است؛ ولی نمونه‌کدهای قدیمی باید با API نسخهٔ 4 سنجیده شوند.

### Gaps
- آمار مستقل و قابل تعمیم از عملکرد 4.2.1 روی طیف گوشی‌ها یا لپ‌تاپ‌های معمولی پیدا نشد؛ تضمین FPS بدون نمونهٔ واقعی و آزمون دستگاه ممکن نیست.

## توانایی‌های پلتفرمر و انتخاب فیزیک

### Takeaway
Phaser بخش‌های تکراری بازی دوبعدی را آماده دارد: صحنه، ورودی لمس و کیبورد، انیمیشن فریم‌به‌فریم، نقشهٔ تایل، دوربین و فیزیک. برای پلتفرمر معمولی، Arcade Physics نقطهٔ شروع ساده و سبک است؛ Matter را برای برخوردهای پیچیده‌تر نگه دارید.

### Cited Findings
- مستندات صحنه‌ها می‌گوید Scene برای منو، بارگذاری، مرحله، باس و جدول امتیاز به کار می‌رود؛ مدیر صحنه به‌روزرسانی و نمایش آنها را کنترل می‌کند. — [Scenes](https://docs.phaser.io/phaser/concepts/scenes)
- سیستم ورودی Phaser رویدادهای موس و لمس را در API مشترک Pointer یکپارچه می‌کند و کیبورد و گیم‌پد را نیز می‌پذیرد. — [Input](https://docs.phaser.io/phaser/concepts/input)
- انیمیشن‌های رایج با فریم‌های sprite sheet یا texture atlas اجرا می‌شوند؛ tween نیز برای تغییراتی مانند حرکت، اندازه و شفافیت وجود دارد. — [Animations](https://docs.phaser.io/phaser/concepts/animations)
- موتور دو سیستم فیزیک تعبیه‌شده دارد: Arcade با دایره و مستطیل برای بازی‌های ساده و پلتفرمر؛ Matter برای شکل‌های پیچیده، اتصال، مفصل و رفتارهای فیزیکی پیشرفته. دو سیستم به‌طور مستقیم با هم برخورد نمی‌کنند. — [Physics](https://docs.phaser.io/phaser/concepts/physics)
- آموزش رسمی پلتفرمر Phaser از Arcade Physics استفاده می‌کند و آن را سبک و مناسب مرورگر موبایل می‌داند؛ سکوهای ثابت را با Static Body می‌سازد. این آموزش بر Phaser 3 بنا شده است. — [Making Your First Phaser Game](https://docs.phaser.io/phaser/getting-started/making-your-first-phaser-game)
- دادهٔ Tilemap می‌تواند از Tiled JSON، CSV یا آرایهٔ دوبعدی خوانده شود؛ ویرایشگر رسمی جریان کاری Tiled JSON و tileset را شرح می‌دهد. — [Tilemap API](https://docs.phaser.io/api-documentation/4.0.0/class/tilemaps-tilemap), [Tilemap Editor](https://docs.phaser.io/phaser-editor/scene-editor/game-objects/tilemap-object)
- هر Scene حداقل یک Camera دارد و دوربین از scroll، zoom، rotate و افکت‌های fade/shake/pan پشتیبانی می‌کند. — [Camera API](https://docs.phaser.io/api-documentation/4.0.0/class/cameras-scene2d-camera)

### Inferences
- پشتهٔ پیشنهادی برای اولین نمونهٔ بازی: Phaser 4 + Arcade Physics + یک Scene بازی + sprite sheet کاراکتر + Tilemap برای مرحله + Camera دنبال‌کننده. کنترل لمسی را از آغاز در نمونهٔ اولیه در نظر بگیرید.
- کیفیت بصری بیشتر به طراحی آرت، انیمیشن، نور و بازخورد ضربه وابسته خواهد بود؛ وجود فیزیک آماده به‌تنهایی ظاهر خوب را تضمین نمی‌کند.

### Gaps
- برتری عددی Arcade نسبت به Matter برای بازی خاص کاربر با دادهٔ مستقل سنجیده نشده است؛ مستندات فقط ماهیت سبک‌تر و ساده‌تر Arcade را توضیح می‌دهد.

## ابزار توسعه، ظاهر، کارایی و انتشار

### Takeaway
برای کسی که VS Code و Vercel را می‌شناسد، قالب رسمی Phaser + TypeScript + Vite یک مسیر کم‌دردسر است. Phaser 4 رندر WebGL و ابزارهای جلوهٔ بصری دارد؛ برای روانی بازی باید اندازهٔ canvas و حجم جلوه‌ها را روی گوشی واقعی تنظیم کرد.

### Cited Findings
- صفحهٔ قالب‌های رسمی، قالب Vite بدون فریم‌ورک و نسخهٔ TypeScript آن را معرفی می‌کند؛ قالب‌های React/Vue هم وجود دارند. — [Project Templates](https://docs.phaser.io/phaser/getting-started/project-templates)
- قالب رسمی `template-vite-ts` با Phaser 4، Vite و TypeScript به‌روز شده است؛ دستور build خروجی `dist` می‌سازد و راهنمای آن انتشار محتویات `dist` روی وب‌سرور عمومی را توضیح می‌دهد. — [Phaser Vite TypeScript Template](https://github.com/phaserjs/template-vite-ts)
- ابزار رسمی شروع پروژه `npm create @phaserjs/game@latest` است و برای انتخاب قالب‌های رسمی تعامل دارد. — [Installing Phaser](https://docs.phaser.io/phaser/getting-started/installation)
- Phaser 4 رندر WebGL بازسازی‌شده دارد؛ Canvas هنوز هست اما به گفتهٔ سازنده deprecated شده و فیلترها، نور و لایه‌های GPU به WebGL متکی‌اند. — [Phaser 4 Renderer](https://phaser.io/news/2026/04/phaser-4-renderer-faster-cleaner-and-built-for-modern-games)
- Phaser 4 فیلترهای بصری از جمله glow، shadow و blur دارد و particle emitter نیز دارد. — [Filters](https://docs.phaser.io/phaser-editor/scene-editor/filters), [Particles](https://docs.phaser.io/phaser/concepts/gameobjects/particles)
- Scale Manager حالت FIT را برای بسیاری از بازی‌ها مناسب می‌داند و هشدار می‌دهد بزرگ‌کردن ابعاد واقعی canvas می‌تواند GPU را به محدودیت نرخ پرکردن پیکسل برساند. — [ScaleManager API](https://docs.phaser.io/api-documentation/4.0.0/class/scale-scalemanager)
- لایهٔ GPU مخصوص sprite و tilemap در Phaser 4 هست، ولی خود سازنده می‌گوید SpriteGPULayer برای چند ده sprite یا شخصیت‌های با رفتار متغیر انتخاب مناسب نیست؛ TilemapGPULayer هم محدودیت نقشهٔ orthographic دارد. — [SpriteGPULayer and TilemapGPULayer](https://phaser.io/news/2026/05/phaser4-spritegpulayer-performance)

### Inferences
- برای پلتفرمر معمولی نیازی به React در هستهٔ بازی نیست؛ Phaser + TypeScript + Vite ساده‌تر است، و React فقط وقتی به UI گستردهٔ بیرون از canvas نیاز باشد معنا پیدا می‌کند.
- خروجی قالب رسمی یک سایت استاتیک است؛ بنابراین می‌توان آن را با میزبان استاتیک مانند Vercel منتشر کرد. این استنتاج بر اساس فایل‌های `dist` قالب و روش انتشار آن است، نه دستور اختصاصی Vercel در مستندات Phaser.
- برای ظاهر شفاف و اجرای روان، از رزولوشن پایهٔ کنترل‌شده با FIT، آرت خوب و تعداد محدود جلوه‌ها شروع کنید؛ سپس روی گوشی میان‌رده و لپ‌تاپ معمولی بررسی کنید. لایه‌های GPU پیشرفته را فقط هنگام مشاهدهٔ گلوگاه واقعی اضافه کنید.

### Gaps
- آزمایش مستقلِ اندازهٔ bundle، زمان بارگذاری و FPS این پشته برای یک بازی مشخص انجام نشده است. همچنین سازگاری دقیق فیلترهای خاص با همهٔ مرورگرهای هدف را باید روی دستگاه واقعی آزمود.
