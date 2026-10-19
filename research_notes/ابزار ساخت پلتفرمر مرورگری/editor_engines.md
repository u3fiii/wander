# موتورهای دارای ادیتور برای پلتفرمر دوبعدی مرورگری

## Godot: چه امکاناتی می‌دهد و برای وب چه محدودیت‌هایی دارد؟

### Takeaway
Godot یک موتور بازی کامل با ادیتور صحنه و ابزار اختصاصی ۲بعدی است. برای پروژه‌ای که بعدها نسخهٔ دسکتاپ یا موبایل هم می‌خواهد، گزینهٔ انعطاف‌پذیری است؛ اما خروجی وب آن نسبت به ابزارهای JavaScript-first بارگذاری و سازگاری بیشتری برای مدیریت دارد.

### Cited Findings
- Godot ۲بعدی رندر، فیزیک، TileMap، ذرات و سیستم انیمیشن اختصاصی دارد؛ طراحی مرحله، انیمیشن کاراکتر و نورپردازی دوبعدی در خود ادیتور انجام می‌شود. — [Godot 2D documentation](https://docs.godotengine.org/en/stable/tutorials/2d/index.html); [Introduction to 2D](https://docs.godotengine.org/en/4.5/tutorials/2d/introduction_to_2d.html)
- خروجی Godot برای مرورگر به WebAssembly و WebGL 2 نیاز دارد؛ Godot 4 فقط رندر Compatibility را برای وب می‌دهد. پروژه‌های Godot 4 نوشته‌شده با C# فعلاً وب‌اکسپورت نمی‌شوند، پس برای پروژهٔ وب بهتر است GDScript انتخاب شود. — [Godot Web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- از Godot 4.3 خروجی تک‌ریسمانی، گزینهٔ پیش‌فرض و ترجیحی وب است و روی macOS/iOS سازگاری بهتری دارد. فعال‌کردن ریسمان‌ها به cross-origin isolation و هدرهای خاص سرور نیاز دارد و با بعضی ادغام‌های ثالث تداخل دارد. — [Godot Web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- وب‌اکسپورت روی موبایل اجرا می‌شود، ولی خود Godot می‌گوید نسخه‌های native Android/iOS به‌طور معنادار سریع‌ترند. برای کاهش بارگذاری موبایل، توصیه می‌کند template خروجی سفارشی با قابلیت‌های استفاده‌نشده حذف‌شده بسازید. — [Godot Web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- خروجی وب فایل‌های `.wasm` (موتور) و `.pck` (محتوای بازی) دارد و Godot فشرده‌سازی هنگام سرو فایل‌ها را توصیه می‌کند، چون این فایل‌ها معمولاً بزرگ‌اند. — [Godot Web export](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- Godot آزاد، رایگان و تحت MIT است؛ بازی تجاری مجاز است. در توزیع بازی باید اعلان حق‌نشر و مجوز Godot در مستندات/کردیت باشد. — [Godot license](https://godotengine.org/license/)

### Inferences
- اگر اولویت مطلق «باز شدن سریع روی لینک وب و موبایل ضعیف» باشد، هزینهٔ دانلود و راه‌اندازی موتور WebAssembly باید برای Godot در یک نمونهٔ واقعی سنجیده شود؛ نمی‌شود صرفاً از نام موتور دربارهٔ سرعت قضاوت کرد.
- برای کاربرِ آشنا با کدنویسی JavaScript/React در پروژهٔ Wander، Godot مهارت و خط لولهٔ تازه‌ای (GDScript/ادیتور/وب‌اکسپورت) می‌طلبد، اما وقتی هدف چند پلتفرم باشد این سرمایه‌گذاری ممکن است ارزشمند باشد.

### Gaps
- منبع رسمی عدد معتبری برای «حجم متوسط خروجی یک پلتفرمر کوچک» یا مقایسهٔ مستقیم FPS و زمان لود Godot با Phaser/Construct ارائه نمی‌کند؛ باید یک نمونهٔ یکسان روی گوشی هدف اندازه‌گیری شود.

## Construct 3: سرعت ساخت، اجرا در مرورگر و هزینه

### Takeaway
Construct 3 برای نمونه‌سازی سریعِ پلتفرمر دوبعدی مزیت دارد: ادیتور بصری و رفتار آمادهٔ Platform. خروجی HTML5 مستقیم دارد؛ نسخهٔ رایگان برای نمونهٔ کوچک مناسب است ولی محدودیت‌های آن برای بازی کامل و کسب درآمد مهم‌اند.

### Cited Findings
- رفتار Platform حرکت از بغل، شیب، سکوی متحرک، سکوی یک‌طرفه، جاذبه با زاویهٔ دلخواه، دوبار پرش، سرعت/شتاب و ارتفاع پرش وابسته به مدت نگه‌داشتن کلید را آماده دارد. می‌توان کنترل آن را به لمس یا گیم‌پد وصل کرد. — [Construct Platform behavior](https://www.construct.net/en/make-games/manuals/construct-3/behavior-reference/platform); [Behavior reference](https://www.construct.net/en/make-games/manuals/construct-3/behavior-reference)
- منطق اصلی بازی در eventها ساخته می‌شود؛ رفتارها میان‌بر هستند و برای نیاز ویژه می‌توان از event یا JavaScript/TypeScript استفاده کرد. — [Construct behaviors](https://www.construct.net/en/make-games/manuals/construct-3/project-primitives/objects/behaviors); [Platform behavior](https://www.construct.net/en/make-games/manuals/construct-3/behavior-reference/platform)
- Construct خروجی وب HTML5 و خروجی اپ‌های موبایل و دسکتاپ دارد. در خروجی وب، deduplication تصویر و بهینه‌سازی فایل‌ها در دسترس است. — [Publishing projects](https://www.construct.net/en/make-games/manuals/construct-3/overview/publishing-projects)
- نسخهٔ رایگان وب‌اکسپورت HTML5 دارد، ولی سقف event آن برای مهمان ۲۵، حساب ثبت‌شده ۴۰ و حساب با ایمیل تأییدشده ۵۰ است. جدول پلن‌ها حداکثر ۲ لایه و ۲ افکت ویژه را برای رایگان نشان می‌دهد؛ درآمدزایی از بازی در پلن رایگان گنجانده نشده است. پلن پولی اشتراکی است و قیمت بسته به منطقه/دورهٔ پرداخت نمایش داده می‌شود. — [Using an account](https://www.construct.net/en/make-games/manuals/construct-3/getting-started/using-an-account); [Construct pricing and feature comparison](https://www.construct.net/en/make-games/buy-construct)
- Construct برای اجرا WebGL می‌خواهد. راهنمای رسمی کارایی توصیه می‌کند روی دستگاه‌های هدف، مخصوصاً موبایل ضعیف، مرتب تست و FPS/CPU/GPU را اندازه بگیرید؛ لایه‌ها و افکت‌های تمام‌صفحه و تصاویر هم‌پوشان می‌توانند فشار رندر زیادی ایجاد کنند. — [System requirements](https://www.construct.net/en/make-games/manuals/construct-3/getting-started/system-requirements); [Performance tips](https://www.construct.net/en/make-games/manuals/construct-3/tips-and-guides/performance-tips)
- فایل تصویری فشرده دانلود را کم می‌کند، اما پس از بارگذاری تصویر برای رندر باز می‌شود و صرفاً تغییر فرمت تصویر لزوماً حافظهٔ زمان اجرا را کم نمی‌کند. — [Memory usage](https://www.construct.net/en/make-games/manuals/construct-3/tips-and-guides/memory-usage); [Performance tips](https://www.construct.net/en/make-games/manuals/construct-3/tips-and-guides/performance-tips)

### Inferences
- برای ساخت یک دمو سریع و لمس‌کردن طراحی مرحله بدون کدنویسی زیاد، Construct 3 بسیار مناسب است. برای پروژهٔ بزرگِ کم‌هزینه یا نیازمند انتشار درآمدزا، محدودیت رایگان و اشتراک باید از ابتدا در تصمیم لحاظ شود.
- کیفیت بصری خودکار از موتور نمی‌آید؛ با طراحی هنری، انیمیشن، نور/افکت و کنترل دقیق ساخته می‌شود. Construct ابزارهای لازم را دارد، اما افکت زیاد ممکن است روی موبایل فشار بیاورد.

### Gaps
- قیمت عددی و امکان پرداخت از ایران را از منبع رسمی قابل اتکا برای وضعیت کاربر احراز نکردم؛ صفحهٔ فروش بر اساس منطقه و روش پرداخت پویا است. هیچ ادعایی دربارهٔ دسترسی پرداخت ایرانی در پاسخ نهایی نباید بدون بررسی جداگانه مطرح شود.

## Unity Web: آیا برای این هدف لازم است؟

### Takeaway
Unity Web اکنون روی برخی مرورگرهای موبایل هم پشتیبانی رسمی دارد؛ سندهای قدیمیِ «موبایل پشتیبانی نمی‌شود» دیگر مبنای درستی برای پاسخ نیستند. برای پلتفرمر دوبعدی سبک با اولویت بارگذاری روان در مرورگر، موتور و خط لولهٔ Unity معمولاً پیچیدگی بیشتری می‌آورد، مگر آنکه سازنده از قبل Unity بلد باشد یا خروجی‌های چندپلتفرمی/قابلیت‌های Unity را بخواهد.

### Cited Findings
- مستندات فعلی Unity Web برای دسکتاپ WebGL 2، مرورگر ۶۴بیتی و WebAssembly را می‌خواهد و برای موبایل Safari iOS 15+ و Chrome Android 58+ را در فهرست پشتیبانی دارد. — [Unity Web browser compatibility](https://docs.unity.com/en-us/engine/6000.6/manual/platform-specific/webgl/intro/browsercompatibility)
- Unity تنظیمی برای progressive asset loading دارد که دارایی‌های صحنه‌های بعدی را پس از آغاز صحنهٔ اول دانلود می‌کند؛ این نشان می‌دهد مدیریت زمان بارگذاری وب یک دغدغهٔ رسمی در خط لولهٔ Unity است. — [Unity progressive asset loading](https://docs.unity.com/en-us/engine/6000.6/manual/platform-specific/webgl/building-distribution/web-optimization/progressive-asset-loading)
- Unity Personal در صفحهٔ رسمی پلن‌ها گزینهٔ رایگان دارد و برای کسب‌وکارهای بالای آستانهٔ درآمد/سرمایه‌گذاری تعیین‌شده پلن بالاتر لازم است؛ عدد دقیق و شرایط ممکن است تغییر کند. — [Unity plans](https://unity.com/products)

### Inferences
- Unity از نظر فنی حذف‌شدنی نیست؛ برای یک بازی عمدتاً مرورگری کوچک، ابتدا هزینهٔ لود و عملکرد روی گوشی هدف را با نمونهٔ واقعی بسنجید. اگر از قبل Unity بلد نیستید و فقط بازی وب دوبعدی می‌سازید، ابزارهای وب‌محور یا Godot احتمالاً مسیر ساده‌تری دارند.

### Gaps
- هیچ بنچمارک رسمی و قابل قیاس مستقیم برای بارگذاری/کارایی Unity در برابر Godot، Construct و Phaser در یک پلتفرمر یکسان پیدا نشد.
