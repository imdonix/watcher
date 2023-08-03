function pad(n, width, z) 
{
    z = z || '0';
    n = n + '';
    return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
  }

function niceDate()
{
    let date = new Date()
    return `${pad(date.getMonth()+1, 2)}/${pad(date.getDate(),2)} ${pad(date.getHours(),2)}:${pad(date.getMinutes(),2)}`
}

function dateOnly()
{
    let date = new Date()
    return `${pad(date.getMonth()+1,2)}/${pad(date.getDate(),2)}`
}

module.exports = { niceDate, dateOnly }