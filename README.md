# Watcher

This app helps you to find "good deals" on the web. 

Currently supported sites:

- jofogas.hu
- ingatlan.com
- hasznaltauto.hu

## How it works

The app scrape the sites and check if a new `deal` is available by the user requirements.
After collecting the `deal`s the user get notified by email.

## Installation

1. Clone the repository:

```bash
git clone https://github.com/imdonix/jofogas-watcher.git
cd jofogas-watcher
npm i
```

2. [Optional] Create a new or use a existing Gmail account for nodemailer - [Help](https://nodemailer.com/usage/using-gmail/)  

3. Edit the `settings.js` file:

```javascript
{
    PORT: process.env.PORT || 80,
    AUTH: { // The sender gmail account 
        user: 'jofogas.watcher@gmail.com', 
        pass: 'Sv5g9pQjtJ4xr5p8M54Z5Qq2tYvDbSTatYRQpYVZz4rJjGmZ34NX6qWEqMBLDpLG' 
    },
    USER: "donix@gmail.com", // The reciver email
    SCRAP: 5, // How ofter you want to scrap the routines in minutes - For example 5 is every 5 minues 
    NOTIFY: 8, // When you want to recive the notifier e-mail in hour - For example 8 is the e-mail will be sent in 8:00 AM
    MASTER: 'jofogas' // The master password to modify your routines
}
```

4. Run. 

```bash
npm start
```

## Preview

![In use](https://raw.githubusercontent.com/imdonix/jofogas-watcher/main/doc/preview.png)
