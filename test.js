const Api = require("./api")

const get_data = async (sub, talk_id) => {
	const api = new Api(sub)
	const data = await api.getTalk(talk_id).then(data=>data).catch(err=>console.log(err.response.data))
	{console.log(data)}
}


	get_data("mysupertestaccount", "100")