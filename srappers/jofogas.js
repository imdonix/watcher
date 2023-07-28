const fetch = require('node-fetch')
const { parse } = require('node-html-parser')
const { cyrb53 } = require('../services/crypto')
const Scraper = require("../services/scraper")

const name = "jofogas.hu"
const depth = 5;
const maxTimeOut = 2;

const DEFAULT_DEPHT = 5
const DOMAIN_NAME = "https://www.jofogas.hu/magyarorszag"
const SLEEP = 200

function scrapJofogas(keywords, settings, callback)
{
    let proper = initSettings(settings ? settings : {})
    processPage(buildUrl(keywords, proper), [], proper.depht, proper, callback)
}

function processPage(url, items, iterations, settings, finalize)
{
    fetch(url, { headers : {'Content-Type' : 'text/plain; charset=iso-8859-2'}})
    .then(res => res.textConverted())
    .then(body => 
        {
            const domRoot = parse(body)
            for(const domItem of domRoot.querySelectorAll('.list-item'))
            {
                let item = processDomItem(domItem)
                if(item)
                    if(!settings.minPrice || settings.minPrice < item.price)
                        if(!settings.maxPrice || settings.maxPrice > item.price)
                            if(settings.enableCompany || !item.company)
                                if(settings.enablePost || !item.post)
                                    items.push(item)
            }
            next(domRoot)
        })
    .catch(_ => next(null))

    function next(root)
    {
        let next = nextPage(root)
        if(iterations > 0 && next)
            setTimeout(() => processPage(next, items, --iterations, settings, finalize), settings.sleep) 
        else
            finalize(items)
    }
}

function processDomItem(item)
{   
    try
    {
        const itemRoot = parse(item);
        const metaAttributes = itemRoot.querySelectorAll('meta').map(dom => dom.attributes)

        return {
            id: toId(metaAttributes.find(prop => prop.itemprop == 'url').content),
            pos: parseInt(metaAttributes.find(prop => prop.itemprop == 'position').content),
            name: metaAttributes.find(prop => prop.itemprop == 'name').content,
            price: parseInt(itemRoot.querySelector('.price-value').attributes.content),
            image: itemRoot.querySelector('img').attributes['src'],
            url: itemRoot.querySelector('.subject').attributes.href,
            company: itemRoot.querySelector('.badge-company_ad') != null,
            post: itemRoot.querySelector('.badge-box') != null
        }
    } catch(_){ return null }
}

function toId(url)
{
    return url.slice(url.indexOf('#')+1)
}

function nextPage(root)
{
    if(root)
        return root.querySelector('.ad-list-pager-item-next').attributes.href
    else 
        return null
}

function initSettings(settings)
{
    return {
        depht: settings.depht || DEFAULT_DEPHT,
        domain: settings.domain || DOMAIN_NAME,
        minPrice : settings.minPrice || null,
        maxPrice : settings.maxPrice || null,
        sleep : settings.sleep || SLEEP,
        enableCompany : settings.enableCompany || false,
        enablePost: settings.enablePost || false
    }
}

function buildUrl(keywords, settings)
{
    return settings.domain + '?' +
    new URLSearchParams(
    {
        'q' : keywords,
        'max_price' : settings.maxPrice ? settings.maxPrice : '',
        'min_price' : settings.minPrice ? settings.minPrice : ''
    });
}

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

            scrapJofogas(routine.keywords, settings, items => {
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