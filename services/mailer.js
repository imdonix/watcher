const nodemailer = require("nodemailer");
const { settings } = require('./cfg');

async function send(title, text, user , html)
{
  // Mail.ejs is a precompiled boostrapmail template
  let out = html

  const transporter = nodemailer.createTransport({
    host: 'smtp.zoho.eu',
    secure: true,
    port: 465,
    auth: {
      user : settings.mail_user,
      pass : settings.mail_pass,
    }
  })

  await transporter.sendMail({
    from: `Watcher <${settings.mail_user}>`,
    to: user,
    subject: title,
    text: text,
    html: out,
})
}

module.exports = send