
import nodemailer from "nodemailer";
// const rateLimit = require("express-rate-limit");

const SendEmailUtil = async (body) => {
  return new Promise((resolve, reject) => {
    const transporter = nodemailer.createTransport({
      host: process.env.HOST,
      // service: process.env.SERVICE,
      port: Number(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      // tls: { rejectUnauthorized: true },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: true, // optional (true is fine unless local dev)
      },
    });

    transporter.verify(function (err, success) {
      if (err) {
        console.error("Error happened when verify:", err.message);
        reject(err);
      } else {
        console.log("Server is ready to take our messages");

        transporter.sendMail(body, (err, info) => {
          if (err) {
            console.error("Error happened when sending email:", err.message);
            reject(err);
          } else {
            console.log("Email sent:", info.response);
            resolve(info);
          }
        });
      }
    });
  });
};

export{
  SendEmailUtil
};