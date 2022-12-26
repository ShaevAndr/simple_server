const axios = require("axios");
const querystring = require("querystring");
const fs = require("fs");
const axiosRetry = require("axios-retry");
const config = require("./config");
const {
  getUserLogger
} = require("./logger");

axiosRetry(axios, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

const LIMIT = 200;

function Api(subdomain, authCode="") {
  this.subDomain = subdomain;
  const logger = getUserLogger(this.subDomain);
  let access_token = null;
  let refresh_token = null;
  const AMO_TOKEN_PATH = `./authclients/${this.subDomain}_amo_token.json`;
  const ROOT_PATH = `https://${this.subDomain}.amocrm.ru`;

  const authChecker = (request) => {
    return (...args) => {
      if (!access_token) {
        return this.getAccessToken().then(() => authChecker(request)(...args));
      }
      return request(...args).catch((err) => {
        logger.error(err.response.data);
        const data = err.response.data;
        if ('validation-errors' in data) {
          data['validation-errors'].forEach(({ errors }) => logger.error(errors))
          logger.error('args', JSON.stringify(args, null, 2))
        }
        if (data.status == 401 && data.title === "Unauthorized") {
          logger.debug("Нужно обновить токен");
          return refreshToken().then(() => authChecker(request)(...args));
        }
        throw err
      });
    };
  };

  const requestAccessToken = () => {
    return axios
      .post(`${ROOT_PATH}/oauth2/access_token`, {
        client_id: config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET,
        grant_type: "authorization_code",
        code: authCode,
        redirect_uri: config.REDIRECT_URI,
        responseType: 'json'
      })
      .then((res) => {
        logger.debug("Свежий токен получен");
        return res.data;
      })
      .catch((err) => {
        logger.error(err.response.data);
        throw err;
      });
  };

  const getAccessToken = async () => {
    if (access_token) {
      return Promise.resolve(access_token);
    }
    try {
      const content = fs.readFileSync(AMO_TOKEN_PATH);
      const token = JSON.parse(content);
      access_token = token.access_token;
      refresh_token = token.refresh_token;
      return Promise.resolve(token);
    } catch (error) {
      logger.error(`Ошибка при чтении файла ${AMO_TOKEN_PATH}`, error);
      logger.debug("Попытка заново получить токен");
      const token = await requestAccessToken();
      fs.writeFileSync(AMO_TOKEN_PATH, JSON.stringify(token));
      access_token = token.access_token;
      refresh_token = token.refresh_token;
      return Promise.resolve(token);
    }
  };

  const refreshToken = () => {
    return axios
      .post(`${ROOT_PATH}/oauth2/access_token`, {
        client_id: config.CLIENT_ID,
        client_secret: config.CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refresh_token,
        redirect_uri: config.REDIRECT_URI,
      })
      .then((res) => {
        logger.debug("Токен успешно обновлен");
        const token = res.data;
        fs.writeFileSync(AMO_TOKEN_PATH, JSON.stringify(token));
        access_token = token.access_token;
        refresh_token = token.refresh_token;
        return token;
      })
      .catch((err) => {
        logger.error("Не удалось обновить токен");
        logger.error(err.response.data);
      });
  };

  this.getAccessToken = getAccessToken;

  this.getAccountData = authChecker(() => {
    return axios.get(`${ROOT_PATH}/api/v4/account`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    }).then((res) => {
      return res.data
    }).catch(err=>{console.log(err.response.data)});
  });

  this.getDeal = authChecker((id, withParam = []) => {
    return axios
      .get(
        `${ROOT_PATH}/api/v4/leads/${id}?${querystring.encode({
          with: withParam.join(","),
        })}`,
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      )
      .then((res) => res.data);
  });

  this.getDeals = authChecker(({ page = 1, limit = LIMIT, filters }) => {
    const url = `${ROOT_PATH}/api/v4/leads?${querystring.stringify({
      page,
      limit,
      with: ['contacts'],
      ...filters,
    })}`;

    return axios
      .get(url, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => {
        return res.data ? res.data._embedded.leads : [];
      });
  });

  this.updateDeals = authChecker((data) => {
    return axios.patch(`${ROOT_PATH}/api/v4/leads`, [].concat(data), {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });

  this.getContacts = authChecker(({ page = 1, limit = LIMIT }) => {
    const url = `${ROOT_PATH}/api/v4/contacts?${querystring.stringify({
      page,
      limit,
      with: ['leads'],
    })}`;
    return axios
      .get(url, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => {
        return res.data ? res.data._embedded.contacts : [];
      });
  });

  this.getContact = authChecker((id) => {
    return axios
      .get(`${ROOT_PATH}/api/v4/contacts/${id}?${querystring.stringify({
        with: ['leads']
      })}`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => res.data);
  });
  
  this.updateContacts = authChecker((data) => {
    return axios.patch(`${ROOT_PATH}/api/v4/contacts`, [].concat(data), {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });
  
  this.createContacts = authChecker((data) => {
    return axios.post(`${ROOT_PATH}/api/v4/contacts`, [].concat(data), {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });
  
  this.createDeals = authChecker((data) => {
    return axios.post(`${ROOT_PATH}/api/v4/leads`, [].concat(data), {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });
  
  this.addDealsComplex = authChecker((data) => {
    return axios.post(`${ROOT_PATH}/api/v4/leads/complex`, [].concat(data), {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });
  
  this.getTasksByEntity = (entityId) => {
    return authChecker(({ page = 1, limit = LIMIT }, id = entityId) => {
      return axios
      .get(`${ROOT_PATH}/api/v4/tasks?filter[entity_id]=${id}?${querystring.stringify({
        page,
        limit,
      })}`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => res.data);
    });
  };
  
  this.updateTask = authChecker((data) => {
    const tasksData = [].concat(data);
    return axios.patch(`${ROOT_PATH}/api/v4/tasks`, tasksData, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });
  
  this.updateTaskComplex = authChecker((data) => {
    return axios.patch(`${ROOT_PATH}/api/v4/tasks`, data, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });

  this.createTasks = authChecker((data) => {
    const tasksData = [].concat(data);
    return axios.post(`${ROOT_PATH}/api/v4/tasks`, tasksData, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });
  });

  this.getPipeline = authChecker((pipelineId) => {
    return axios
      .get(`${ROOT_PATH}/api/v4/leads/pipelines/${pipelineId}`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => res.data);
  });

  this.getStatus = authChecker(({ pipelineId, statusId }) => {
    return axios
      .get(
        `${ROOT_PATH}/api/v4/leads/pipelines/${pipelineId}/statuses/${statusId}`,
        {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
        )
        .then((res) => res.data);
  });

  this.getUser = authChecker((userId) => {
    return axios
      .get(`${ROOT_PATH}/api/v4/users/${userId}`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => res.data);
  });

  this.getUsers = authChecker(({ page = 1, limit = LIMIT }) => {
    const url = `${ROOT_PATH}/api/v4/users?${querystring.stringify({
      page,
      limit,
    })}`;
    return axios
      .get(url, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => {
        return res.data ? res.data._embedded.users : [];
      });
    });
    
    this.getCompany = authChecker((id, withParam = []) => {
      return axios
      .get(`${ROOT_PATH}/api/v4/companies/${id}?${querystring.stringify({
        with: withParam.join(","),
      })}`, {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
      .then((res) => res.data);
    });
    
    this.updateCompany = authChecker((data) => {
      return axios.patch(`${ROOT_PATH}/api/v4/companies`, [].concat(data), {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      });
    });
    
    this.createUnsorted = authChecker((data) => {
      return axios.post(`${ROOT_PATH}/api/v4/leads/unsorted/forms`, [].concat(data), {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      })
    });
    
    this.getTalk = authChecker((id) => {
      return axios
        .get(`${ROOT_PATH}/api/v4/talks/${id}`, {
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        })
        .then((res) => res.data);
    });
  }
  
module.exports = Api;