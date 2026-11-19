const crypto = require("crypto");

const ITERATIONS = 1989;
const KEY_SIZE = 32; // 256 bit
const IV_SIZE = 16;  // 128 bit

function generateKey(password) {
  return Buffer.from(password.substring(0, 32));
}

// ================= ENCRYPT =================
function encrypt(plainText, password) {
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(IV_SIZE);

  const key = generateKey(password, salt);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(plainText, "utf8", "base64");
  encrypted += cipher.final("base64");

  return salt.toString("hex") + iv.toString("hex") + encrypted;
}

// ================= DECRYPT =================
function decrypt(cipherText, password) {
  try {
    const saltHex = cipherText.substring(0, 64);   // 32 bytes → 64 hex
    const ivHex = cipherText.substring(64, 96);    // 16 bytes → 32 hex
    const encrypted = cipherText.substring(96);

    const salt = Buffer.from(saltHex, "hex");
    const iv = Buffer.from(ivHex, "hex");

    const key = generateKey(password, salt);

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (e) {
    return "Decrypt error: " + e.message;
  }
}

// ================= CLI =================
const mode = process.argv[2];
const input = process.argv[3];
const key = process.argv[4];

if (!mode || !input || !key) {
  console.log(`
Usage:
  node aes_tool.js enc "text" "secret"
  node aes_tool.js dec "cipher" "secret"
`);
  process.exit();
}

if (mode === "enc") {
  console.log(encrypt(input, key));
} else if (mode === "dec") {
  console.log(decrypt(input, key));
} else {
  console.log("Invalid mode. Use enc or dec");
}