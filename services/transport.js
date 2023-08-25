class Transport
{
    name() { throw new Error('Not implemented.') }
    required() { throw new Error('Not implemented.') }
    async send(title, user, raw, html) { throw new Error('Not implemented.') }
}

module.exports = Transport