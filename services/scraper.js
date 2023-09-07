const { cyrb53 } = require('./crypto')

function abs()
{
    throw new Error('Abstract function not implemented')
}

class Scraper
{
    id() { abs(); return '' }

    getOptions() { abs(); return {} }

    async scrapPage(routine, page) { abs(); return {items : Array(), page : 0} }
}

module.exports = Scraper