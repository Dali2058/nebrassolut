// api/index.js
// نفس السلوك بتاع server.js الأصلي، لكن الحفظ والرفع بيتوجهوا لـ GitHub
// بدل الكتابة على القرص، لأن Vercel serverless مالوش نظام ملفات دائم.

const express = require("express");
const multer = require("multer");
const path = require("path");
const { getFile, listDir, putFile, deleteFile } = require("../lib/github");

const app = express();
const ADMIN_CODE = process.env.ADMIN_CODE || "matrix5";

// Vercel Serverless Functions بترفض أي طلب أكبر من ~4.5MB، فحدّينا الرفع على 4MB
// عشان الفيديوهات الكبيرة محتاجة حل تاني (Vercel Blob) لو عايز ترفع فيديو أكبر من كده.
const MAX_UPLOAD_MB = 4;

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true, limit: "4mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image|video)\//.test(file.mimetype);
    cb(ok ? null : new Error("مسموح فقط بملفات صور أو فيديو"), ok);
  },
});

function safePage(name) {
  return /^[a-zA-Z0-9_-]+\.html$/.test(name) ? name : null;
}

function auth(req, res, next) {
  if (req.headers["x-admin-code"] === ADMIN_CODE || req.body?.code === ADMIN_CODE) return next();
  return res.status(401).json({ error: "غير مصرح" });
}

function titleFromHtml(html, fallback) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (m ? m[1].replace(/\s+/g, " ").trim() : fallback).slice(0, 120);
}

function mimeFromExt(name) {
  const ext = path.extname(name).toLowerCase();
  return (
    {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".mov": "video/quicktime",
      ".ogg": "video/ogg",
    }[ext] || "application/octet-stream"
  );
}

app.get("/admin", (_req, res) => res.sendFile(path.join(process.cwd(), "admin.html")));

app.get("/api/pages", auth, async (_req, res, next) => {
  try {
    const files = await listDir("");
    const htmlFiles = files.filter(
      (f) => f.type === "file" && f.name.endsWith(".html") && f.name !== "admin.html"
    );
    const withTitles = await Promise.all(
      htmlFiles.map(async (f) => {
        const file = await getFile(f.path);
        return { file: f.name, slug: f.name.replace(/\.html$/, ""), title: titleFromHtml(file.content, f.name) };
      })
    );
    res.json(withTitles);
  } catch (e) {
    next(e);
  }
});

app.get("/api/page/:file", auth, async (req, res, next) => {
  try {
    const file = safePage(req.params.file);
    if (!file) return res.status(400).json({ error: "اسم صفحة غير صالح" });
    const f = await getFile(file);
    if (!f) return res.status(404).json({ error: "الصفحة غير موجودة" });
    res.json({ file, title: titleFromHtml(f.content, file), html: f.content });
  } catch (e) {
    next(e);
  }
});

app.post("/api/page/:file", auth, async (req, res, next) => {
  try {
    const file = safePage(req.params.file);
    if (!file || typeof req.body.html !== "string") return res.status(400).json({ error: "بيانات غير صالحة" });
    const existing = await getFile(file);
    if (!existing) return res.status(404).json({ error: "الصفحة غير موجودة" });
    await putFile(file, req.body.html, `CMS: تحديث ${file}`, existing.sha);
    res.json({ ok: true, message: "تم الحفظ على GitHub، جاري نشر التحديث تلقائيًا على Vercel..." });
  } catch (e) {
    next(e);
  }
});

app.post(
  "/api/upload",
  auth,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  },
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: "لم يتم اختيار ملف" });
      const ext = path.extname(req.file.originalname).toLowerCase();
      const safe =
        path
          .basename(req.file.originalname, ext)
          .replace(/[^\p{L}\p{N}_-]+/gu, "-")
          .slice(0, 60) || "media";
      const filename = `${Date.now()}-${safe}${ext}`;
      await putFile(`uploads/${filename}`, req.file.buffer, `CMS: رفع ${filename}`);
      res.json({
        ok: true,
        url: `/api/media-file/${encodeURIComponent(filename)}`,
        name: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size,
      });
    } catch (e) {
      next(e);
    }
  }
);

app.get("/api/media", auth, async (_req, res, next) => {
  try {
    const files = await listDir("uploads");
    const mediaFiles = files.filter(
      (f) => f.type === "file" && /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|ogg)$/i.test(f.name)
    );
    res.json(
      mediaFiles
        .map((f) => ({ name: f.name, url: `/api/media-file/${encodeURIComponent(f.name)}`, size: f.size }))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  } catch (e) {
    next(e);
  }
});

app.delete("/api/media/:name", auth, async (req, res, next) => {
  try {
    const name = path.basename(decodeURIComponent(req.params.name));
    const filePath = `uploads/${name}`;
    const f = await getFile(filePath);
    if (!f) return res.status(404).json({ error: "الملف غير موجود" });
    await deleteFile(filePath, `CMS: حذف ${name}`, f.sha);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// بروكسي عام للوسائط — من غير auth عشان زوار الموقع العادي يقدروا يشوفوا الصور/الفيديوهات
app.get("/api/media-file/:name", async (req, res, next) => {
  try {
    const name = path.basename(decodeURIComponent(req.params.name));
    const f = await getFile(`uploads/${name}`, { binary: true });
    if (!f) return res.status(404).send("Not found");
    res.set("Content-Type", mimeFromExt(name));
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(f.content);
  } catch (e) {
    next(e);
  }
});

app.get("/page/:file", (req, res) => {
  const file = safePage(req.params.file);
  if (!file) return res.status(400).send("Bad page");
  res.sendFile(path.join(process.cwd(), file), (err) => err && res.status(404).send("Page not found"));
});

app.get("/:file", (req, res, next) => {
  const file = safePage(req.params.file);
  if (!file) return next();
  res.sendFile(path.join(process.cwd(), file), (err) => err && next());
});

app.get("/", (_req, res) => res.sendFile(path.join(process.cwd(), "index.html")));
app.use(express.static(process.cwd(), { index: false }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "حدث خطأ في الخادم" });
});

module.exports = app;
