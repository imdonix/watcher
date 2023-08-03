function niceDate()
{
    let date = new Date()
    return `${date.getMonth()+1}/${date.getDate()} ${date.getHours()}:${date.getMinutes()}`
}

module.exports = { niceDate }