/*
Standalone scrapper for jofogas.hu
*/

const fetch = require('node-fetch')
const { parse } = require('node-html-parser')

const CLIENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.72 Safari/537.36'
const DOMAIN_NAME = "https://www.jofogas.hu/magyarorszag"

async function scrapJofogasPage(settings, page)
{
    const adjusted = initSettings(settings ? settings : {})
    return processPage(buildUrl(adjusted, page), adjusted)
}

function initSettings(settings)
{
    return {
        keywords: settings.keywords || null,
        domain: settings.domain || DOMAIN_NAME,
        minPrice : settings.minPrice || null,
        maxPrice : settings.maxPrice || null,
        enableCompany : settings.enableCompany || false,
        enablePost: settings.enablePost || false
    }
}

function buildUrl(settings, page)
{
    return settings.domain + '?' +
    new URLSearchParams(
    {
        'q' : settings.keywords,
        'o' : page,
        'max_price' : settings.maxPrice ? settings.maxPrice : '',
        'min_price' : settings.minPrice ? settings.minPrice : '',
    });
}

async function processPage(url, settings)
{
    const items = Array()

    const result = await fetch(url, { headers : { 'Content-Type' : 'text/plain; charset=iso-8859-2', 'User-Agent' : CLIENT }})
    const raw = await result.arrayBuffer()
    const decoder = new TextDecoder("iso-8859-2")
    const text = decoder.decode(raw)

    const domRoot = parse(text)
    
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
    
    return {items, page : nextPage(domRoot) }
}

function processDomItem(item)
{   
    function toId(url)
    {
        return url.slice(url.indexOf('#')+1)
    }

    try
    {
        const itemRoot = parse(item);
        const metaAttributes = itemRoot.querySelectorAll('meta').map(dom => dom.attributes)

        return {
            id: toId(metaAttributes.find(prop => prop.itemprop == 'url').content),
            name: metaAttributes.find(prop => prop.itemprop == 'name').content,
            price: parseInt(itemRoot.querySelector('.price-value').attributes.content),
            image: itemRoot.querySelector('img').attributes['src'],
            url: itemRoot.querySelector('.subject').attributes.href,
            company: itemRoot.querySelector('.badge-company_ad') != null,
            post: itemRoot.querySelector('.badge-box') != null
        }
    } 
    catch(a){ console.error(a) }
}



function nextPage(root)
{
    const elem = root.querySelector('.ad-list-pager-item-next')?.attributes?.href
    if(elem)
    {
        const params = new URLSearchParams(elem)
        return params.get('o')
    }
    else
    {
        return NaN
    }
}


module.exports = scrapJofogasPage