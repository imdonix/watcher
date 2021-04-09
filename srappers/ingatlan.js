const scrap = require('ingatlan-scraper')
const { cyrb53 } = require('../services/crypto')
const Scraper = require("../services/scraper")

const name = "ingatlan.com"
const depth = 5;
const maxTimeOut = 2;

class Ingatlan extends Scraper
{
    constructor()
    {
        super(name)
        this.id = this.uniqueID(name)
    }

    scrap(routine)
    {
        return new Promise((res, _) => 
        {
            let options = {
                depht: 7,                     
                timeout: this.timeOut(),
                search: routine.search
            }

            scrap(options, items => {
                items.forEach(item => {
                    item.id = cyrb53(`${item.url}-${name}`)
                    item.name = item.where
                })
                res(items)
            })
        })
    }

    getOptions()
    {
        return [
            {
                id : "search",
                name : "Search params form ingatlan.com",
                type : "text" 
            }
        ]
    }

    getItemModel()
    {
        return [
            "id", 
            "url",
            "where",
            "price",
            "area"
        ]
    }

    timeOut()
    {
        return Math.floor(Math.random() * Math.floor(maxTimeOut * 1000)) + 1000;
    }


}

module.exports = Ingatlan