const DB = require("./db").DB
const Api = require("./api")
const EventEmitter = require("events")

const pushEmiter = new EventEmitter()




let first_mesasage = null
let timer = null

//  Инициализация. Получаем сообзщение с самым ранним временем действия и запускаем таймер на реализацию.
const init = async () => {
    // pushEmiter.emit('message', {data:"mysupermessage"})
    let early_message = await DB.get_early_message()
    first_mesasage = early_message
    if (!early_message) {
        return
    }
    console.log("init     ", early_message._id)
    if (early_message.action_time <= Date.now()+10) {
        console.log("in if")
        await realize_actions(early_message)
    }
    else {
        timer = setTimeout(realize_actions, early_message.action_time - Date.now(), early_message)
    }    
}

// Добавляет сообщение в базу. И если время срабатывания меньше, чем в текушем сообщении (first_action)
// сбрасывает таймер и заного проходит инициализацию
const add_message_to_db = async (actions, message) => {
    message.action_time = (Number(message.updated_at) + Number(actions.delay_time) * 60) * 1000
    message.actions = actions
    DB.add_message(message)
    .then(()=>{
        if (!first_mesasage || message.action_time <= first_mesasage.action_time) {
            if (timer) {
                clearTimeout(timer)
            }
            init()
        }
    })
    
}

// Проверяем нужно ли обновлять сообщение (есть ли ответ или более ранние сообщения).
const need_update = async (talk_id, subdomain) => {
    const have_answer = await message_have_answer(talk_id, subdomain)
    if (have_answer) {
        return true
    }
    const messages = await DB.find_message({"talk_id":`${talk_id}`})
    return messages.length ? false : true
}

// проверяем есть ли ответ на сообщение
const message_have_answer = async (talk_id, subdomain) => {
    const api = new Api(subdomain)
    const talk = await api.getTalk(talk_id).then(data=>data)
    if (talk.is_read) {
        DB.delete_message({"talk_id":talk_id})
    }
    return talk.is_read
}

const message_processing = async (message) => {
    
// Проверяем есть ли более ранние сообщения и есть ли ответ на последние сообщение
    const need_add_message = await need_update(message.talk_id, message.subdomain)
    if (!need_add_message) {
        console.log("takoi chat uje est")
        return
    }
    const user_actions = await DB.find_actions(message.subdomain, {"manager.id":String(message.responsible_id)}) || []
    const group_actions = await DB.find_actions(message.subdomain, {"manager.id":`group_${message.group_id}`}) || []
    const actions = [...user_actions, ...group_actions]

    if (!actions.length) {
        console.log("net deystviy")
        return
    }
    actions.forEach(action=>{add_message_to_db(action, message)})
}

const realize_actions = async (message) =>{
    console.log("realize_action     ", message._id)
    const api = new Api(message.subdomain)
    if (message.actions.task){
        await api.createTasks([{
            "entity_id":message.lead_id,
            "entity_type": "leads",
            // "task_type_id": message.actions.task.type.id,
            "responsible_user_id": Number(message.actions.task.responsible.id),
            "text": message.actions.task.text,
            "complete_till":1680147241
            // "complete_till":parseInt(Date.now()/1000 + 3600)
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
            // "_embedded[tags][0][id]": message.actions.tags[0].id
        }).catch(err=>{console.log(err.response.data)})
    }
    if (message.actions.notice){
return
    }
    await DB.delete_message({"_id":message._id})
    init()
}

const delete_talk = (talk_id) =>{
    console.log(talk_id)
    DB.delete_message({"talk_id":talk_id})
    .then(()=>{
        if (first_mesasage.talk_id === talk_id) {
            clearTimeout(timer)
            first_mesasage = null
            init()
        }
    })
    .catch(err => {console.log("xnj-nj gjikj yt nfr")})

}

module.exports = {
    message_processing,
    init, 
    delete_talk
}