const express = require("express");
const multer = require("multer");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());
app.use(express.static(__dirname));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const META_TOKEN = process.env.META_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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

app.post("/send-campaign", upload.single("image"), async (req, res) => {
  try {
    if (!META_TOKEN || !PHONE_NUMBER_ID) {
      return res.status(500).json({
        error: "Meta ayarları eksik.",
        sent: 0,
        failed: 0
      });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Görsel seçilmedi.",
        sent: 0,
        failed: 0
      });
    }

    const numbers = (req.body.numbers || "")
      .split(/[\n,;]+/)
      .map(number => number.replace(/\D/g, ""))
      .filter(Boolean);

    if (numbers.length === 0) {
      return res.status(400).json({
        error: "Alıcı numarası bulunamadı.",
        sent: 0,
        failed: 0
      });
    }

    // Görseli WhatsApp'a yükle
    const mediaForm = new FormData();
    const imageBlob = new Blob(
      [req.file.buffer],
      { type: req.file.mimetype }
    );

    mediaForm.append("messaging_product", "whatsapp");
    mediaForm.append("file", imageBlob, req.file.originalname);

    const mediaResponse = await fetch(
      `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/media`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${META_TOKEN}`
        },
        body: mediaForm
      }
    );

    const mediaData = await mediaResponse.json();

    if (!mediaResponse.ok || !mediaData.id) {
      console.error("Media upload error:", mediaData);

      return res.status(500).json({
        error: "Görsel Meta'ya yüklenemedi.",
        details: mediaData,
        sent: 0,
        failed: numbers.length
      });
    }

    const mediaId = mediaData.id;

    let sent = 0;
    let failed = 0;
    const errors = [];

    // Her numaraya ayrı WhatsApp API isteği
    for (const to of numbers) {
      const messageResponse = await fetch(
        `https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${META_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: {
              name: "urun_pazarlama_yerli",
              language: {
                code: "tr"
              },
              components: [
                {
                  type: "header",
                  parameters: [
                    {
                      type: "image",
                      image: {
                        id: mediaId
                      }
                    }
                  ]
                }
              ]
            }
          })
        }
      );

      const messageData = await messageResponse.json();

      if (messageResponse.ok) {
        sent++;
      } else {
        failed++;
        errors.push({
          to: to,
          error: messageData
        });
      }
    }

    res.json({
      success: failed === 0,
      sent: sent,
      failed: failed,
      errors: errors
    });

  } catch (error) {
    console.error("Campaign error:", error);

    res.status(500).json({
      error: error.message,
      sent: 0,
      failed: 0
    });
  }
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
