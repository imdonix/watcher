/*
Standalone scrapper for hasznaltauto.hu
*/

const fetch = require('node-fetch')
const { parse } = require('node-html-parser')


const IDREG = /\/([0-9]+)_([0-9]+)t\.jpg/
const CLIENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.72 Safari/537.36'
const URL = 'https://www.hasznaltauto.hu/talalatilista'

async function scrapHasznaltautoPage(settings, page)
{
    const adjusted = initSettings(settings)
    return await processPage(adjusted, page)
}

function initSettings(settings)
{
    return {
        key: settings.key
    }
}

function buildUrl(settings, page)
{
    return `${URL}/${settings.key}/page${page}`
}

async function processPage(settings, page)
{
    const items = new Array()

    const result = await fetch(buildUrl(settings, page), { headers: { 'User-Agent' : CLIENT } })
    const raw = await result.arrayBuffer()
    const decoder = new TextDecoder("utf-8")
    const text = decoder.decode(raw)

    const domRoot = parse(text)
    for(const domItem of domRoot.querySelectorAll('.talalati-sor'))
    {
        try
        {
            const item = processDomItem(domItem)
            items.push(item)
        } 
        catch(err){ console.log(err) }
    }   

    return {items, page : nextPage(domRoot)}
}

function processDomItem(item)
{
    return {
        id : IDREG.exec(item.querySelector('.img-responsive')?.attributes.src)[1],
        name :  item.querySelector('h3').firstChild.innerText,
        image: item.querySelector('.img-responsive').attributes.src.replace('t.jpg', '.jpg'),
        url: item.querySelector('.img-responsive').parentNode?.getAttribute('href'),
        price: getPrice(item.querySelector('.pricefield-primary')?.innerText || item.querySelector('.pricefield-primary-highlighted')?.innerText),
        ad: item.querySelector('.trader-name')?.innerText.indexOf('Magánszemély') == -1
    }
}

function getPrice(element)
{
    if(!element) throw new Error('Price could not be extracted')

    let trimmed = element.replace(/\s/g,'')
    return Number(trimmed.substring(0, trimmed.length - 2));
}

function nextPage(root)
{
    const elem = root.querySelector('.next')
    if(elem)
    {
        const link = elem.querySelector('a').attributes.href
        return /\/page([0-9]+)/.exec(link)[1]
    }
    else
    {
        return NaN
    }
}


module.exports = scrapHasznaltautoPage