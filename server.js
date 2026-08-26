const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = "matrix5";

const ROOT = __dirname;
const PAGES = ROOT;
const UPLOADS = path.join(ROOT, "uploads");
fs.mkdirSync(UPLOADS, { recursive: true });

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));
app.use("/uploads", express.static(UPLOADS));
app.use(express.static(ROOT, { index: false }));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = path.basename(file.originalname, ext)
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .slice(0, 60) || "media";
    cb(null, `${Date.now()}-${safe}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image|video)\//.test(file.mimetype);
    cb(ok ? null : new Error("Only image/video files are allowed"), ok);
  }
});

function safePage(name) {
  return /^[a-zA-Z0-9_-]+\.html$/.test(name) ? name : null;
}
function auth(req, res, next) {
  if (req.headers["x-admin-code"] === ADMIN_CODE || req.body?.code === ADMIN_CODE) return next();
  return res.status(401).json({ error: "غير مصرح" });
}

app.get("/", (_req, res) => res.sendFile(path.join(PAGES, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(ROOT, "admin.html")));

app.get("/api/pages", auth, (_req, res) => {
  const files = fs.readdirSync(PAGES).filter(x => x.endsWith(".html"));
  res.json(files.map(file => ({
    file,
    slug: file.replace(/\.html$/,""),
    title: titleFromFile(file)
  })));
});

function titleFromFile(file) {
  try {
    const html = fs.readFileSync(path.join(PAGES,file),"utf8");
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return (m ? m[1].replace(/\s+/g," ").trim() : file).slice(0,120);
  } catch { return file; }
}

app.get("/api/page/:file", auth, (req,res) => {
  const file=safePage(req.params.file);
  if(!file) return res.status(400).json({error:"اسم صفحة غير صالح"});
  const full=path.join(PAGES,file);
  if(!fs.existsSync(full)) return res.status(404).json({error:"الصفحة غير موجودة"});
  res.json({file, title:titleFromFile(file), html:fs.readFileSync(full,"utf8")});
});

app.post("/api/page/:file", auth, (req,res) => {
  const file=safePage(req.params.file);
  if(!file || typeof req.body.html!=="string") return res.status(400).json({error:"بيانات غير صالحة"});
  const full=path.join(PAGES,file);
  if(!fs.existsSync(full)) return res.status(404).json({error:"الصفحة غير موجودة"});
  fs.writeFileSync(full, req.body.html, "utf8");
  res.json({ok:true, message:"تم حفظ الصفحة"});
});

app.post("/api/upload", auth, upload.single("file"), (req,res) => {
  if(!req.file) return res.status(400).json({error:"لم يتم اختيار ملف"});
  res.json({
    ok:true,
    url:`/uploads/${req.file.filename}`,
    name:req.file.originalname,
    type:req.file.mimetype,
    size:req.file.size
  });
});

app.get("/api/media", auth, (_req,res) => {
  const files=fs.readdirSync(UPLOADS).filter(f=>/\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|ogg)$/i.test(f));
  res.json(files.map(f=>({
    name:f,
    url:`/uploads/${f}`,
    size:fs.statSync(path.join(UPLOADS,f)).size
  })).sort((a,b)=>a.name.localeCompare(b.name)));
});

app.delete("/api/media/:name", auth, (req,res)=>{
  const name=path.basename(req.params.name);
  const full=path.join(UPLOADS,name);
  if(!fs.existsSync(full)) return res.status(404).json({error:"الملف غير موجود"});
  fs.unlinkSync(full);
  res.json({ok:true});
});

app.get("/:file", (req,res,next)=>{
  const file=safePage(req.params.file);
  if(!file) return next();
  const full=path.join(PAGES,file);
  if(!fs.existsSync(full)) return res.status(404).send("Page not found");
  res.sendFile(full);
});

app.get("/page/:file", (req,res)=>{
  const file=safePage(req.params.file);
  if(!file) return res.status(400).send("Bad page");
  const full=path.join(PAGES,file);
  if(!fs.existsSync(full)) return res.status(404).send("Page not found");
  res.sendFile(full);
});

app.use((err,_req,res,_next)=>{
  console.error(err);
  res.status(500).json({error:err.message || "حدث خطأ في الخادم"});
});

app.listen(PORT,()=>console.log(`Nebras CMS running on http://localhost:${PORT}`));
