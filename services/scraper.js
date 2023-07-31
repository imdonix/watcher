const { cyrb53 } = require('./crypto')

function abs()
{
    throw new Error('Abstract function not implemented')
}

class Scraper
{
    constructor(name)
    {
        this.name = name;
    }

    uniqueID(name)
    {
        return cyrb53(name) % 10000;
    }

    scrap(routine) { abs() }

    getOptions() { abs() }
    
    getItemModel() { abs() }
}

module.exports = Scraper