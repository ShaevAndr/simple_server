const DB = require("./db").DB
const Api = require("./api")


let first_message = null
let timer = null
let users = {}


const convert_task_date = (date_string) => {
    let date = new Date()
    date.setHours(0, 0, 0)
    switch (date_string) {
        case "inMoment":
            return parseInt(Date.now()/1000)
        case "today":
            return parseInt(date/1000) + 24*3600
        case "afterDay":
            return parseInt(date/1000) + 2*24*3600
        case "3DayLater":
            return parseInt(date/1000) + 3*24*3600
        case "forWeek":
            return parseInt(date/1000) + 7*24*3600
    }
}

//  Инициализация. Получаем сообзщение с самым ранним временем действия и запускаем таймер на реализацию.
const set_message_timer = (message) => {
    let delay = 0
    if (message.action_time > Date.now()+1000) {
        delay = message.action_time - Date.now()
    }
    console.log("delay:    ", delay)
    
    timer = setTimeout(realize_actions, delay, message)
    console.log("выход из установки таймера")
}

const init = async () => {
    let early_message = null
    try{
        early_message = await DB.get_early_message()
    } catch {
        return
    }
    if (!early_message) {
        first_message = null
        return
    }
    first_message = early_message
    set_message_timer(early_message)    
}

// Добавляет сообщение в базу. И если время срабатывания меньше, чем в текушем сообщении (first_action)
// сбрасывает таймер и заного проходит инициализацию
const add_message_to_db = async (actions, message) => {
    message.action_time = (Number(message.updated_at) + Number(actions.delay_time) * 60) * 1000
    message.actions = actions
    message._id = String(Date.now()) + String(Math.floor(Math.random() * 100))
    const result = await DB.add_message(message)
    .then((data)=>{
        if (!first_message || message.action_time < first_message.action_time) {
            if (timer) {
                clearTimeout(timer)
                first_message = message
            }
            set_message_timer(message)
        }
        return data

    })    
    return result 
}


// Проверяем нужно ли обновлять сообщение (есть ли ответ или более ранние сообщения).
const need_update = async (talk_id) => {
    const messages = await DB.find_message({"talk_id":`${talk_id}`})
    return messages.length ? false : true
}

// проверяем есть ли ответ на сообщение
const message_have_answer = async (talk_id, subdomain) => {
    const api = new Api(subdomain)
    const talk = await api.getTalk(talk_id).then(data=>data)
    return talk.is_read
}

const message_processing = async (message) => {
    
// Проверяем есть ли более ранние сообщения и есть ли ответ на последние сообщение
    const need_add_message = await need_update(message.talk_id, message.subdomain)
    if (!need_add_message) {
        return
    }
    const user_actions = await DB.find_actions(message.subdomain, {"manager.id":String(message.responsible_id)}) || []
    const group_actions = await DB.find_actions(message.subdomain, {"manager.id":`group_${message.group_id}`}) || []
    const actions = [...user_actions, ...group_actions]

    if (!actions.length) {
        return
    }
    for (action of actions) {
        const result = await add_message_to_db(action, message)
    }
}

const realize_actions = async (message) =>{
    const have_answer = await message_have_answer(message.talk_id, message.subdomain)
    if (have_answer) {
        await delete_talk(message.talk_id, message.subdomain)
        init()
        return
    }
    const api = new Api(message.subdomain)

    if (message.actions.task){
        await api.createTasks([{
            "entity_id":message.lead_id,
            "entity_type": "leads",
            "task_type_id": message.actions.task.type.id,
            "responsible_user_id": Number(message.actions.task.responsible.id),
            "text": message.actions.task.text,
            "complete_till":convert_task_date(message.actions.task.date)
        }]).catch(err=>{console.log(err.response.data)})
        
    }
    if (message.actions.new_responsible){
        await api.updateDeals({
            "id":message.lead_id,
            "responsible_user_id": Number(message.actions.new_responsible.id)
        }).catch(err=>{console.log(err.response.data)})
    }
    if (message.actions.tags){
        const tags = message.actions.tags.map(tag=>{return{"id":tag.id}})
        await api.updateDeals({
            "id":message.lead_id,
            "_embedded": {
                "tags": tags
            }
        }).catch(err=>{console.log(err.response.data)})
    }
    if (message.actions.notice){
        console.log("realiza_actions отправка в телеграмм")
        if (users[message.actions.manager.id]){
            
            users[message.actions.manager.id].send_to_client()
        }
    }
    await DB.delete_message({"_id":message._id})
    init()
}

// Удаляет сообщение в чате, если оно прочитанно
const delete_talk = (talk_id, subdomain) =>{
    DB.delete_message({"talk_id":String(talk_id), "subdomain":subdomain})
    .then(()=>{
        if (!first_message) {
            return
        }
        if (first_message.talk_id === talk_id) {
            clearTimeout(timer)
            first_message = null
            init()
        }
    })
    .catch(err => {console.log("data_proccesing error delete_talk", err)})

}

const add_client = (emiter) => {
    users[emiter.user] = emiter
}

module.exports = {
    message_processing,
    init, 
    delete_talk,
    add_client
}