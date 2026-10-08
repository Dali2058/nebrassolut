// lib/github.js
// كل الحفظ/القراءة بتتم عن طريق GitHub Contents API بدل نظام الملفات المحلي،
// لأن نظام ملفات Vercel Serverless مؤقت ومش بيتحفظ بين الطلبات.

const GITHUB_API = "https://api.github.com";

function cfg() {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";
  const token = process.env.GITHUB_TOKEN;
  if (!owner || !repo || !token) {
    throw new Error(
      "متغيرات GitHub ناقصة: تأكد من ضبط GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN في إعدادات Vercel"
    );
  }
  return { owner, repo, branch, token };
}

function encodePath(p) {
  // نرمّز كل جزء من المسار لوحده عشان نحافظ على الشرطات المائلة
  return p.split("/").map(encodeURIComponent).join("/");
}

async function gh(pathname, opts = {}) {
  const { owner, repo, token } = cfg();
  // نشيل أي Slash زيادة في الآخر لو pathname فاضي (قراءة الجذر) عشان GitHub API
  // بيرفض أحيانًا مسار فيه Slash فاضي زي contents/?ref=main
  const base = `${GITHUB_API}/repos/${owner}/${repo}/contents`;
  const url = pathname.startsWith("?") ? `${base}${pathname}` : `${base}/${pathname}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "nebras-cms",
      ...(opts.headers || {}),
    },
  });
  return res;
}

// يرجع null لو الملف مش موجود
async function getFile(path, { binary = false } = {}) {
  const { branch } = cfg();
  const res = await gh(`${encodePath(path)}?ref=${encodeURIComponent(branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile فشل (${res.status}): ${await res.text()}`);
  const data = await res.json();
  if (Array.isArray(data)) throw new Error(`${path} مجلد مش ملف`);
  const buffer = Buffer.from(data.content, "base64");
  return { sha: data.sha, content: binary ? buffer : buffer.toString("utf8"), size: data.size };
}

// يرجع [] لو المجلد مش موجود
async function listDir(path) {
  const { branch } = cfg();
  const res = await gh(`${path ? encodePath(path) : ""}?ref=${encodeURIComponent(branch)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub listDir فشل (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

// content ممكن يكون string أو Buffer. لو sha موجود بيعمل تحديث، لو مش موجود بيعمل إنشاء
async function putFile(path, content, message, sha) {
  const { branch } = cfg();
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const res = await gh(encodePath(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: buffer.toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub putFile فشل (${res.status}): ${await res.text()}`);
  return res.json();
}

async function deleteFile(path, message, sha) {
  const { branch } = cfg();
  const res = await gh(encodePath(path), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) throw new Error(`GitHub deleteFile فشل (${res.status}): ${await res.text()}`);
  return res.json();
}

module.exports = { getFile, listDir, putFile, deleteFile };
