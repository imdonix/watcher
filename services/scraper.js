const { cyrb53 } = require('./crypto')

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

    scrap(routine){}

    getOptions(){}
    
    getItemModel(){}
}

module.exports = Scraper