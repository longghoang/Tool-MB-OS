const express = require("express");
const router = express.Router();

const aesService = require("../services/aes.service");

const DEFAULT_KEY =
    "11111111111111111111111111111111";

const DEFAULT_IV =
    "2222222222222222";

router.get("/", (req, res) => {
    res.render("aes-tool", {
        result: null,
        error: null,
        mode: "encrypt"
    });
});

router.post("/encrypt", (req, res) => {
    try {
        const { content } = req.body;

        const result = aesService.encrypt(
            content,
            DEFAULT_KEY,
            DEFAULT_IV
        );

        res.render("aes-tool", {
            result,
            error: null,
            mode: "encrypt"
        });

    } catch (err) {

        res.render("aes-tool", {
            result: null,
            error: err.message,
            mode: "encrypt"
        });
    }
});

//UULR5I4EX2E6QCLURUEFITEF 
//cc8007378164fbc6
//1fda24bb66909823
//9983c4338f27f69d
//b2eef3364a546a20
//72f581004ef10f9d






router.post("/decrypt", (req, res) => {
    try {

        const { content } = req.body;

        const result = aesService.decrypt(
            content,
            DEFAULT_KEY,
            DEFAULT_IV
        );

        res.render("aes-tool", {
            result,
            error: null,
            mode: "decrypt"
        });

    } catch (err) {

        res.render("aes-tool", {
            result: null,
            error: err.message,
            mode: "decrypt"
        });
    }
});

module.exports = router;