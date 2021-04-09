const scrap = require('ingatlan-scraper')
const { cyrb53 } = require('../services/crypto')
const Scraper = require("../services/scraper")

const name = "ingatlan.com"
const depth = 3;
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
                depth: depth,                     
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
                id : "keywords",
                name : "Tag (only for the user)",
                type : "text" 
            },
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
            "image",
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