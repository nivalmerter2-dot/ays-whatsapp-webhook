const express = require("express");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// Meta webhook doğrulaması
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook doğrulandı.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// WhatsApp'tan gelen mesajlar ve buton yanıtları
app.post("/webhook", (req, res) => {
  console.log("WhatsApp webhook:", JSON.stringify(req.body, null, 2));
  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("AYS WhatsApp Webhook çalışıyor.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(Webhook ${PORT} portunda çalışıyor.);
});
