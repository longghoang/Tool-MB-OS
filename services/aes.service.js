const crypto = require("crypto");

class AESHelper {
    constructor() {
        this.keySize = 16;
        this.algorithm = "aes-128-cbc";
    }

    getBytes(strValue) {
        const buffer = Buffer.alloc(this.keySize);

        const inputBuffer = Buffer.from(strValue, "utf8");

        inputBuffer.copy(
            buffer,
            0,
            0,
            Math.min(inputBuffer.length, this.keySize)
        );

        return buffer;
    }

    encrypt(plainText, keyStr, ivStr) {
        const key = this.getBytes(keyStr);
        const iv = this.getBytes(ivStr);

        const cipher = crypto.createCipheriv(
            this.algorithm,
            key,
            iv
        );

        let encrypted = cipher.update(
            plainText,
            "utf8",
            "hex"
        );

        encrypted += cipher.final("hex");

        return encrypted;
    }

    decrypt(hexInput, keyStr, ivStr) {
        const key = this.getBytes(keyStr);
        const iv = this.getBytes(ivStr);

        const decipher = crypto.createDecipheriv(
            this.algorithm,
            key,
            iv
        );

        let decrypted = decipher.update(
            hexInput,
            "hex",
            "utf8"
        );

        decrypted += decipher.final("utf8");

        return decrypted;
    }
}

module.exports = new AESHelper();