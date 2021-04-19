const { cyrb53 } = require('./crypto')
const settings = require('../settings')

module.exports = {
    auth: (req, res, next) =>
    {
        let pass = req.body.pass
        if(pass === cyrb53(settings.MASTER) || settings.DEV)
            next()
        else
            res.status(401).send()
    }
}