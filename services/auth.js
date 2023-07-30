const { cyrb53 } = require('./crypto')
const settings = require('./cfg');

module.exports = {
    auth: (req, res, next) =>
    {
        let pass = req.body.pass

        for (const user of settings().users) 
        {
            if(pass === cyrb53(user.master) || settings.DEV)
            {
                res.locals.user = user.name
                next()
                return
            }
        }

        res.status(401).send()
    }
}