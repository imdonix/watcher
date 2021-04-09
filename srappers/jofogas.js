const scrap = require('jofogas-scraper')
const { cyrb53 } = require('../services/crypto')
const Scraper = require("../services/scraper")

const name = "jofogas.hu"
const depth = 5;
const maxTimeOut = 2;

class Jofogas extends Scraper
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
            let settings = {
                depht: depth,
                domain: routine.domain,
                minPrice : routine.minPrice,
                maxPrice : routine.maxPrice,
                sleep : this.timeOut(),
                enableCompany : routine.enableCompany,
                enablePost: routine.enablePost
            }

            scrap(routine.keywords, settings, items => {
                items.forEach(item => item.id = cyrb53(`${item.id}-${name}`))
                res(items)
            })
        })
    }

    getOptions()
    {
        return [
            {
                id : "keywords",
                name : "Keywords",
                type : "text" 
            },
            {
                id : "domain",
                name : "Platform URL",
                type : "url",
                default : `http://${name}/budapest`
            },
            {
                id : "minPrice",
                name : "Min price",
                type : "number" 
            },
            {
                id : "maxPrice",
                name : "Max price",
                type : "number" 
            },
            {
                id : "enableCompany",
                name : "Enable company ad",
                type : "checkbox" 
            },
            {
                id : "enablePost",
                name : "Enable post service",
                type : "checkbox" 
            }
        ]
    }

    getItemModel()
    {
        return [
            "id", 
            "pos", 
            "name", 
            "price", 
            "url", 
            "company", 
            "post", 
            "found"
        ]
    }

    timeOut()
    {
        return Math.floor(Math.random() * Math.floor(maxTimeOut * 1000)) + 1000;
    }


}

module.exports = Jofogas