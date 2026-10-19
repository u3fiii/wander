# مسیرهای جاوااسکریپتی غیر از Phaser برای پلتفرمر مرورگری

## کدام ابزار رندر می‌کند و کدام سیستم بازی آماده دارد؟

### Takeaway
PixiJS برای تصویر دوبعدیِ سفارشی و پرجزئیات مناسب است، اما به‌تنهایی موتور بازی نیست؛ Excalibur.js و melonJS موتورهای کامل‌تری هستند و برای پلتفرمر، فیزیک، برخورد، صحنه و ورودی را آماده‌تر ارائه می‌کنند.

### Cited Findings
- PixiJS رسماً خود را کتابخانهٔ رندر می‌نامد و تصریح می‌کند که موتور بازی نیست؛ امکانات اصلی آن شامل رندر، ساختار صحنه، دارایی‌ها، لمس/کلیک و حلقهٔ به‌روزرسانی است. — [FAQ رسمی PixiJS](https://pixijs.com/faq)، [راهنمای معماری](https://pixijs.com/8.x/guides/concepts/architecture)
- Matter.js یک موتور فیزیک دوبعدی جداگانه برای وب است؛ نصب npm و API برخورد، جاذبه، جسم‌ها و رویداد دارد. — [مخزن رسمی Matter.js](https://github.com/liabru/matter-js)، [مستندات API](https://brm.io/matter-js/docs/index.html)
- Excalibur.js دارای Actor، Scene، دوربین، انیمیشن، TileMap، ورودی و فیزیک است. فیزیک Arcade آن برای برخورد سادهٔ پلتفرمر پیشنهاد شده و پیش‌فرض است؛ فیزیک realistic هم دارد. — [فهرست ویژگی‌های رسمی](https://excaliburjs.com/docs/why-excalibur/)، [راهنمای فیزیک](https://excaliburjs.com/docs/physics/)، [راهنمای شروع](https://excaliburjs.com/docs/quick-start/)
- Excalibur.js نمونهٔ رسمی پلتفرمر و افزونهٔ اتصال به ویرایشگرهای Tiled و LDtk دارد. — [راهنمای نصب و نمونه‌ها](https://excaliburjs.com/docs/installation/)، [ابزارهای جانبی](https://excaliburjs.com/docs/why-excalibur/)
- melonJS از تصویر، فیزیک/برخورد داخلی، دوربین، ورودی، صوت، TileMap، حالت‌های بازی و ذرات پشتیبانی می‌کند؛ راهنمای رسمی و نمونهٔ پلتفرمر دارد. — [مخزن رسمی melonJS](https://github.com/melonjs/melonJS)

### Inferences
- برای پلتفرمر نخست با کمترین کار اتصال کتابخانه‌ها، Excalibur یا melonJS از PixiJS+Matter.js ساده‌ترند. PixiJS+Matter.js برای کنترل دقیق‌تر تصویر و معماری مفید است، اما توسعه‌دهنده باید موقعیت جسم‌های فیزیکی و Spriteها، دوربین، ورودی و ساختار مراحل را یکپارچه کند. این نتیجه‌گیری از فهرست قابلیت‌های هر ابزار است، نه سنجش زمان ساخت.
- برای پرش خوش‌حس، حتی با فیزیک داخلی باید شتاب، ارتفاع پرش، فاصلهٔ مجاز برای پریدن بعد از لبه و کمک پرش پیش از فرود را با سلیقهٔ بازی تنظیم کرد؛ موتور فقط زیرساخت برخورد را فراهم می‌کند.

### Gaps
- آزمایش مستقل و همسانی برای زمان توسعهٔ یک پلتفرمر یکسان با این سه مسیر نیافتم؛ رتبه‌بندی قطعیِ «آسان‌ترین» مستند نیست.

## برای اجرای روان و تصویر باکیفیت در مرورگر، چه محدودیت‌هایی مهم است؟

### Takeaway
هر سه مسیر مرورگرمحورند، اما کیفیت و روانی به اندازه و تعداد تصاویر، جلوه‌ها، اندازهٔ canvas و دستگاه مخاطب بستگی دارد. هیچ منبع رسمی مقایسهٔ مستقیم معتبری ندیدم که یکی را برای همهٔ موبایل‌ها سریع‌ترین بداند.

### Cited Findings
- PixiJS در نسخهٔ ۸، WebGL را رندر پیش‌فرض پایدار و توصیه‌شده برای تولید می‌داند؛ WebGPU در مستندات رندر هنوز آزمایشی توصیف شده است. — [راهنمای رندر PixiJS](https://pixijs.com/8.x/guides/components/renderers)
- راهنمای کارایی PixiJS استفاده از spritesheet، بافت کوچک‌تر برای دستگاه قدیمی، احتیاط در تعداد فیلتر و mask، و کاهش antialias در بعضی موبایل‌های قدیمی را توصیه می‌کند. — [راهنمای کارایی PixiJS](https://pixijs.com/8.x/guides/concepts/performance-tips)
- Excalibur.js به‌طور پیش‌فرض WebGL به کار می‌برد و در نبود WebGL/شتاب سخت‌افزاری می‌تواند به Canvas2D برگردد؛ برخی جلوه‌های پس‌پردازش و رندرهای سفارشی در Canvas2D کار نمی‌کنند. — [راهنمای Graphics Context](https://excaliburjs.com/docs/graphics-context/)
- Excalibur.js می‌گوید نسخه‌های جدید دو مرورگر رایج دسکتاپ و موبایل را هدف پشتیبانی دارد و با BrowserStack خودکار بررسی می‌کند. — [مخزن رسمی Excalibur](https://github.com/excaliburjs/excalibur)
- melonJS نسخهٔ ۲۰ با حالت AUTO از WebGPU به WebGL2 و سپس Canvas2D برمی‌گردد؛ WebGL1 کنار گذاشته شده است. نویسندگان آن ادعا می‌کنند موتور حدود ۲۵۰ کیلوبایت پس از minify+gzip است؛ این عدد اندازهٔ کل بازی همراه گرافیک و صدا نیست. — [README رسمی melonJS](https://github.com/melonjs/melonJS)
- در منابع رسمی PixiJS تناقض نسخه‌ای دیده می‌شود: صفحهٔ رندر Canvas2D را «Coming soon» می‌نامد، ولی یادداشت انتشار ۸.۱۶.۰ عرضهٔ آزمایشی Canvas renderer و fallback را اعلام می‌کند؛ هنگام پیاده‌سازی باید نسخهٔ دقیق نصب‌شده و پشتیبانی ویژگی‌های لازم بررسی شود. — [راهنمای رندر PixiJS](https://pixijs.com/8.x/guides/components/renderers)، [یادداشت انتشار ۸.۱۶.۰](https://pixijs.com/blog/8.16.0)

### Inferences
- برای شروع، خروجی WebGL، تصویرهای فشرده و کم‌تعداد در spritesheet و جلوه‌های محدود انتخاب محافظه‌کارانه‌ای برای موبایل است؛ سپس باید روی چند گوشی واقعی اندازهٔ دانلود، زمان بارگذاری و نرخ فریم را سنجید. این نتیجه از راهنماهای رسمی کارایی است، نه benchmark بین موتورها.
- موتور نمی‌تواند گرافیک ضعیف یا فایل‌های هنری خیلی حجیم را صرفاً با انتخاب نام کتابخانه اصلاح کند.

### Gaps
- benchmark کنترل‌شده و هم‌نسخه روی گوشی ضعیف برای PixiJS، Excalibur و melonJS پیدا نشد؛ هیچ ادعای نسبی دربارهٔ FPS یا زمان لود نمی‌توان مستند کرد.

## راه‌اندازی، TypeScript، هزینه و انتخاب عملی چگونه است؟

### Takeaway
هر سه رایگان و متن‌بازند و با Vite/TypeScript قابل شروع‌اند. Excalibur برای پلتفرمر کدنویسی‌شده نقطهٔ آغاز ساده‌ای است؛ PixiJS+Matter.js آزادی بیشتری می‌دهد و اتصال دستی بیشتری می‌طلبد؛ melonJS مسیر سومِ موتور کامل با قالب آماده است.

### Cited Findings
- Excalibur.js رایگان و متن‌باز با مجوز BSD 2-Clause و TypeScript-first است؛ CLI رسمی `npm init excalibur@latest` قالب اجرایی می‌سازد. مخزن رسمی هشدار می‌دهد پروژه هنوز در سری 0.x است و نسخه‌های جدید ممکن است تغییرات ناسازگار داشته باشند. — [سایت رسمی](https://excaliburjs.com/)، [شروع سریع](https://excaliburjs.com/docs/quick-start/)، [مخزن رسمی](https://github.com/excaliburjs/excalibur)
- PixiJS رایگان و متن‌باز با مجوز MIT و پشتیبانی TypeScript است؛ قالب رسمی `npm create pixi.js@latest` دارد. — [FAQ رسمی PixiJS](https://pixijs.com/faq)، [مخزن رسمی و TypeScript](https://github.com/pixijs/pixijs)، [شروع سریع](https://pixijs.com/8.x/guides/getting-started/quick-start)
- Matter.js مجوز MIT دارد و جدا با `npm install matter-js` نصب می‌شود. — [مخزن رسمی Matter.js](https://github.com/liabru/matter-js)
- melonJS مجوز MIT دارد؛ `npm create melonjs my-game` پروژهٔ Vite+TypeScript می‌سازد و بسته با TypeScript declarations عرضه می‌شود. خروجی پیش‌فرض ES2022 است؛ برای مرورگرهای قدیمی‌تر باید خود melonJS هم transpile شود. — [مخزن رسمی melonJS](https://github.com/melonjs/melonJS)

### Inferences
- برای کاربر آشنا با پروژهٔ وب و Vercel، هر سه می‌توانند به‌عنوان فایل‌های استاتیکِ ساخته‌شده با Vite منتشر شوند؛ نیاز به سرور بازی برای پلتفرمر تک‌نفره از قابلیت‌های توصیف‌شده نتیجه نمی‌شود.
- کیفیت بصری در همهٔ گزینه‌ها به هنر، انیمیشن و طراحی وابسته است؛ توان موتور تعیین نمی‌کند بازی خودبه‌خود شبیه بازی با بودجهٔ بالا دیده شود.

### Gaps
- هزینهٔ استقرار، پهنای باند و ابزارهای هنری از مجوز موتور جدا هستند و به میزبان و محتوای بازی بستگی دارند؛ در این تحقیق برآورد قیمت نکردم.
