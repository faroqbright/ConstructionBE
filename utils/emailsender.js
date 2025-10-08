
import nodemailer from "nodemailer";
// const rateLimit = require("express-rate-limit");

const SendEmailUtil = async (body) => {
  return new Promise((resolve, reject) => {
    // Validate required environment variables
    if (!process.env.HOST || !process.env.EMAIL_PORT || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      const missingVars = [];
      if (!process.env.HOST) missingVars.push('HOST');
      if (!process.env.EMAIL_PORT) missingVars.push('EMAIL_PORT');
      if (!process.env.EMAIL_USER) missingVars.push('EMAIL_USER');
      if (!process.env.EMAIL_PASS) missingVars.push('EMAIL_PASS');
      
      const error = new Error(`Missing required email configuration: ${missingVars.join(', ')}`);
      console.error("Email configuration error:", error.message);
      reject(error);
      return;
    }

    // Validate email body
    if (!body || !body.to || !body.subject) {
      const error = new Error('Email body must include "to" and "subject" fields');
      console.error("Email validation error:", error.message);
      reject(error);
      return;
    }

    console.log(`Attempting to send email to: ${body.to}`);
    
    const transporter = nodemailer.createTransport({
      host: process.env.HOST,
      port: Number(process.env.EMAIL_PORT),
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        ciphers: 'SSLv3',
        rejectUnauthorized: true,
      },
    });

    transporter.verify(function (err, success) {
      if (err) {
        console.error("SMTP connection verification failed:", err.message);
        reject(err);
      } else {
        console.log("SMTP server connection verified successfully");

        transporter.sendMail(body, (err, info) => {
          if (err) {
            console.error("Failed to send email:", err.message);
            console.error("Email details:", { to: body.to, subject: body.subject });
            reject(err);
          } else {
            console.log("Email sent successfully to", body.to, "- Response:", info.response);
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