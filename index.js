const {mainLogger, getUserLogger } = require("./logger");
const Api = require("./api");
const express = require('express');
const DB = require("./db").DB;
const fs = require("fs");
const data_processing = require("./data_processing")
const EventEmitter  = require('events');
const pushEmit = new EventEmitter()
const cors = require("cors");


const app = express();
app.use(express.json());
app.use(cors({ origin: "*"}));
app.use(express.urlencoded({ extended: true }));
data_processing.init()

class Notice {
    constructor (res, data){
        this.emitter = new EventEmitter()
        this.res = res;
        this.subdomain = data.subdomain
        this.user = data.id
        this.res.setHeader('Content-Type', 'text/event-stream');
        this.res.setHeader('Cache-Control', 'no-cache');
        this.res.setHeader('Connection', 'keep-alive');
        this.res.setHeader("Content-Encoding", "identity");
        this.res.setHeader("Access-Control-Allow-Origin", "*");
        this.res.setHeader("Access-Control-Allow-Methods", "*");
        setInterval(()=>{this.res.write('data: {"ping": "pong"} \n\n')}, 30000)
        this.emitter.on("notification", ()=>{
            this.res.write("event: notification\n")
            this.res.write("data:from server \n\n")})
    }

    send_to_client () {
        this.emitter.emit("notification")
    }

    
}

app.post("/informer", (req, res)=>{
    console.log(req.body)
    res.sendStatus(200)
})
// удаляет действие
app.delete('/data_change', (req, res) => {
    const {subdomain, changes} = req.body
    DB.delete_action(subdomain, changes)
    .then(()=>res.json({send:"ok"}))
    .catch(()=>res.sendStatus(400))
})

// Обновляет действие и возвращает его
app.patch('/data_change', (req, res) => {
    const {subdomain, changes} = req.body
    DB.change_action(subdomain, changes)
    .then(()=>{
        DB.get_action_by_id(subdomain, changes._id)
        .then(data=>res.json(data))
    })
    .catch(()=>res.sendStatus(400))
    
})

// Добавлеят новое дейтвие в бд и возвращает новое действие
app.post('/data_change', async (req, res) => {
    const {subdomain, changes} = req.body
    DB.add_action(subdomain, changes)
    .then(data => DB.get_action_by_id(subdomain, data.insertedId))
    .then(data=>{
        return res.json(data)})
    .catch(error=>{return res.sendStatus(400)})
})

// Отправляет все условия из бд
app.post("/get_actions", (req, res) => {
    const {subdomain} = req.body
    DB.get_all_actions(subdomain)
    .then(data=>res.json(data))
    .catch(()=>res.sendStatus(400))
}) 

app.post("/new_message", async (req, res)=>{
    try{        
        const {chat_id, talk_id, created_at, contact_id, updated_at} = req.body.message.add[0],
        {subdomain, id} = req.body.account;
        const searchingUser = await DB.get_account_by_subdomain(subdomain)
        const isSubscribe = searchingUser.finishUsingDate - Date.now();
        if (isSubscribe<0) {
        console.log("не оплачено")

            return res.sendStatus(200)
        }
        const api = new Api(subdomain)
        let message = {chat_id,
            talk_id,
            created_at,
            contact_id,
            subdomain,
            account_id: id}
        const talk = await api.getTalk(talk_id)
        console.log(talk)
        const lead_id = talk._embedded["leads"][0]["id"]
        const lead = await api.getDeal(lead_id)
        message.lead_id = lead_id
        message.updated_at = talk.updated_at
        message.is_read = talk.is_read
        message.responsible_id = lead.responsible_user_id
        message.group_id = lead.group_id
            data_processing.message_processing(message)

        res.sendStatus(200)
    } catch {
        console.log("new message error")
        // logger.error(`Новое сообщение не обработанно. Talk_id: ${talk_id}`)
        res.sendStatus(400)
    }
})
app.post("/change_talk", async (req, res)=>{    
    if (req.body.talk.update[0].is_read === "1"){
        const talk_id = req.body.talk.update[0].talk_id
        const subdomain = req.body.account.subdomain
        data_processing.delete_talk(talk_id, subdomain)
    }
    res.sendStatus(200)
})

app.get('/login', async (req, res) => {
    try {
        let { client_id: integrationId, referer: subDomain, code: authCode } = req.query;
        subDomain = subDomain.split('.', 1)[0]
        const logger = getUserLogger(subDomain);
        logger.debug("Got request for widget installation");
        const api = new Api(subDomain, authCode);
        await api.getAccessToken()
        .then(() => logger.debug(`Авторизация при установке виджета для ${subDomain} прошла успешно`))
        .catch((err) => logger.debug("Ошибка авторизации при установке виджета ", subDomain, err.data));
        
        const subdomain_in_base = await DB.get_account_by_subdomain(subDomain)
        console.log(subdomain_in_base)
        if (!subdomain_in_base) {
            const account = await api.getAccountData();
            const accountId = account.id;
            logger.debug(`получен id аккаунта:${accountId}`)
            const accountInfo = {
                subDomain: subDomain,
                "accountId": accountId,
                "authCode": authCode,
                "startUsingDate": Date.now(),
                "finishUsingDate": Date.now() + 15*24*60*60*1000,
                "paid": false,
                "installed": true,
                "testPeriod": true                
                }
                await DB.add_account(accountInfo)
                .then(() => logger.debug("Данные о пользователе были добавлены в базу данных виджета"))
                .catch((err) => logger.debug("Произошла ошибка добавления данных в БД ", err));
            } else {
                await DB.update_account_by_subdomain(subDomain, {
                    "installed": true,
                    "authCode": authCode
                })
                .then(() => {logger.debug("Данные о пользователе были обновлены в базе данных виджета")
                return res.status(200)})
                
                .catch((err) => logger.debug("Произошла ошибка обновления данных в БД ", err));
            }
            
            // Дублирование данных клиента в KEYPRO
            // await makeRedirect(`${config.WIDGET_CONTROLLER_URL}/informer`, { client_id: integrationId })
            
            // При установке с сайта reon.pro делаем redirect в amoCRM
            // const redirectUrl = `https://${subDomain}.amocrm.ru/settings/widgets/`
            // res.redirect(redirectUrl);
        } catch(e) {
            res.status(400).json({ message: "Login error." })
        }
    });


app.get('/delete', async (req, res) => {
    try {
        const accountId = Number(req.query.account_id);
        const  clientAccountData  = await DB.find_account({accountId});
        const subDomain = clientAccountData.subDomain;
        const AMO_TOKEN_PATH = `./authclients/${subDomain}_amo_token.json`;
        const logger = getUserLogger(subDomain);
        
        fs.unlinkSync(AMO_TOKEN_PATH);
        
        await DB.update_account_by_subdomain(subDomain, {
            "installed": false,
            "authCode": ""
        })
            .then(() => logger.debug("Данные о пользователе были обновлены в базе данных виджета"))
            .catch((err) => logger.debug("Произошла ошибка обновления данных в БД ", err));
        logger.debug("Виджет был удалён из аккаунта");
    } catch(e) {
        console.log(e);
        res.status(400).json({ message: "Login error.", body: e })
    }
    // await makeRedirect(`${config.WIDGET_CONTROLLER_URL}/del`, { ...req.query })
    res.status(200);
});

app.get('/status', async (req, res) => {
    const subdomain = req.query.subdomain;
    const logger = getUserLogger(subdomain);
    const searchingUser = await DB.get_account_by_subdomain(subdomain)
    const isSubscribe = searchingUser.finishUsingDate - Date.now();
    if (searchingUser && subdomain) {
        const returnedObject = {
            paid: searchingUser.paid,
            testPeriod: searchingUser.testPeriod,
            startUsingDate: searchingUser.startUsingDate,
            finishUsingDate: searchingUser.finishUsingDate
        }
        if (isSubscribe < 0){
            if (searchingUser.paid || searchingUser.testPeriod){
                DB.update_account_by_subdomain(subdomain, {
                    "paid": false,
                    "testPeriod": false
                }).then(() => logger.debug("Статус оплаты subdomain: " + subdomain + " изменен на false"))
                .catch((err) => logger.debug("Произошла ошибка обновления данных в БД ", err));
            }
            return res.status(200).json({...returnedObject, response: 'notPaid', paid: false, testPeriod: false})
        }
        if (searchingUser.testPeriod) {
            return res.status(200).json({...returnedObject, response: 'trial'})
        }
        if (searchingUser.paid) {
            return res.status(200).json({...returnedObject, response: 'paid'})
        } 
    } else {
        return res.status(200).json({
            response: 'userNotFound'
        })
    }
})


app.get("/notification", (req, res)=>{
    const data = req.query
    const emiter = new Notice(res, data)
    data_processing.add_client(emiter)

})
   
app.listen(2000, () => console.log("app is starting"));        

