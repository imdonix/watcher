const nodemailer = require("nodemailer");
const { settings } = require('../services/cfg');

const Transport = require('../services/transport')

class Mail extends Transport
{
  name() { return 'Mail'}
  required() { return [
    'mail_host',
    'mail_port',
    'mail_user',
    'mail_pass',
  ]}

  async send(title, user, raw, html)
  {
    // Mail.ejs is a precompiled boostrapmail template
    let out = html

    const transporter = nodemailer.createTransport({
      host: settings.mail_host,
      secure: true,
      port: settings.mail_port,
      auth: {
        user : settings.mail_user,
        pass : settings.mail_pass,
      }
    })

    await transporter.sendMail({
      from: `Watcher <${settings.mail_user}>`,
      to: user,
      subject: title,
      html: out,
    })
  }

}

module.exports = Mail