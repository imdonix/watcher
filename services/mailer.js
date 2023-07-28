const nodemailer = require("nodemailer");

const settings = require('../settings')

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.eu',
  secure: true,
  port: 465,
  auth: settings.AUTH
})

async function send(title, text, html)
{
    await transporter.sendMail({
      from: `Watcher <${settings.AUTH.user}>`,
      to: settings.USER,
      subject: title,
      text: text,
      html: html,
  })
}

module.exports = send