const scrap = require('hasznaltauto-scraper')
const { cyrb53 } = require('../services/crypto')
const Scraper = require("../services/scraper")

const name = "hasznaltauto.hu"
const depth = 2;
const maxTimeOut = 2;

class Auto extends Scraper
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
                depth: depth,                     
                timeout: this.timeOut(),
                key: routine.key
            }

            scrap(options, items => {
                items.forEach(item => {
                    item.id = cyrb53(`${item.url}-${name}`)
                })
                res(items)
            })
        })
    }

    getOptions()
    {
        return [
            {
                id : "keywords",
                name : "Tag (only for the user)",
                type : "text" 
            },
            {
                id : "key",
                name : "Key",
                type : "text" 
            }
        ]
    }

    getItemModel()
    {
        return [
            "name",
            "image",
            "url",
            "price",
            "ad"
        ]
    }

    timeOut()
    {
        return Math.floor(Math.random() * Math.floor(maxTimeOut * 1000)) + 1000;
    }

}

module.exports = Auto