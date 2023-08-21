const fetch = require('node-fetch')
const { settings } = require('../services/cfg');

const Transport = require('../services/transport')

class HTTP extends Transport
{
  name() { return 'Http' }
  required() { return ['http_url'] }

  async send(title, user, html)
  {
    // Mail.ejs is a precompiled boostrapmail template
    let out = html
        
    const body = {title, user, html : out}

    await fetch(settings.http_url, {
        method: 'post',
        body: JSON.stringify(body),
        headers: {'Content-Type': 'application/json'}
    })
  }
}

module.exports = HTTP