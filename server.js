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

app.get("/privacy", (req, res) => {
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Gizlilik Politikası - AYS Group Nermin Nival</title>
      </head>
      <body>
        <h1>Gizlilik Politikası</h1>
        <p>AYS Group Nermin Nival, WhatsApp üzerinden müşterileriyle iletişim kurmak amacıyla WhatsApp Business hizmetlerini kullanmaktadır.</p>
        <p>Müşteriler tarafından paylaşılan iletişim ve mesajlaşma bilgileri yalnızca müşteri iletişimi, talep yönetimi ve hizmet sunumu amacıyla işlenir.</p>
        <p>Kişisel veriler yetkisiz üçüncü taraflarla paylaşılmaz ve yürürlükteki veri koruma mevzuatına uygun şekilde işlenir.</p>
        <p>Verilerinizle ilgili talepleriniz için işletmemizle iletişime geçebilirsiniz.</p>
        <p>AYS Group Nermin Nival</p>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Webhook ${PORT} portunda çalışıyor.`);
});
