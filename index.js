const express = require('express'),
    Twig = require("twig");


const app = express()
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("twig options", {
    allow_async: true, // Allow asynchronous compiling
    strict_variables: false
});



app.get("/", (req, res) =>{
    console.log('get data')
    res.render('control_settings.twig', {
        select_menager:{
            items  : [{id:1, option:"Выбор пользователя / отдела", additional_data:"fergfds"}, {id:2, option:"test1"}, {id:3, option:"test4"}, {id:4, option:"test3"},], 
            id: "select_manager"
        },
        delay_1:{
            name: "delay_1",
            id: "delay_1",
            placeholder: "Кол-во мин. без ответа клиенту"
        },
    });
})
app.post('/getamo', (req, res) => {
    AMO = req.body
    res.sendStatus(200)
})

app.get("/lookatthis", (req, res) => {
    console.log("look")
    res.send(AMO)
}) 

 

app.listen(2000, () => console.log("app is starting"));   