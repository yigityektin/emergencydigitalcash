const fs = require("node:fs");

const file = process.env.REVOKE_FILE || "./revoked_uids.json";
const [,, cmd, uidRaw] = process.argv;

if (!cmd || !uidRaw) {
  console.log("Usage: node revoke_uid.cjs add|rm CA0F79B4");
  process.exit(1);
}

const uid = uidRaw.toUpperCase();

let j;
try { j = JSON.parse(fs.readFileSync(file, "utf8")); }
catch { j = { revoked: [] }; }

const set = new Set((j.revoked || []).map(x => String(x).toUpperCase()));

if (cmd === "add") set.add(uid);
else if (cmd === "rm") set.delete(uid);
else {
  console.log("cmd must be add or rm");
  process.exit(1);
}

j.revoked = [...set];
fs.writeFileSync(file, JSON.stringify(j, null, 2));
console.log("OK:", j);