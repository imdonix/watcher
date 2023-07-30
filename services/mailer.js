const nodemailer = require("nodemailer");
const fs = require('fs/promises')
const { execSync } = require("child_process");

const settings = require('../settings')

const transporter = nodemailer.createTransport({
  host: 'smtp.zoho.eu',
  secure: true,
  port: 465,
  auth: settings.AUTH
})

async function send(title, text, html)
{

  let out = html

  try
  {
    await fs.writeFile('data/tmp.html', html)
    execSync('bootstrap-email data/tmp.html > data/out.html')
    out = (await fs.readFile('data/out.html')).toString()
    await fs.rm('data/tmp.html')
    await fs.rm('data/out.html')
  }
  catch(err)
  {
    console.warn(`[Mailer] Bootsrap compalition failed, raw mail will be sent: ${err}`)
  }

  await transporter.sendMail({
    from: `Watcher <${settings.AUTH.user}>`,
    to: settings.USER,
    subject: title,
    text: text,
    html: out,
})
}

module.exports = send