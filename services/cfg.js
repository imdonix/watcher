const fs = require('fs')

let cache = null

function settings()
{
    
    if (cache == null)
    {
        const data = fs.readFileSync('data/global.json')
        cache = JSON.parse(data)
    }

    return cache
}


module.exports = settings

