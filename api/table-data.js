const https = require('https');

const envVars = {
    FEISHU_APP_ID: process.env.FEISHU_APP_ID,
    FEISHU_APP_SECRET: process.env.FEISHU_APP_SECRET,
    FEISHU_APP_TOKEN: process.env.FEISHU_APP_TOKEN,
    FEISHU_TABLE_ID: process.env.FEISHU_TABLE_ID,
    FEISHU_VIEW_ID: process.env.FEISHU_VIEW_ID,
};

const cache = {
    tenantAccessToken: null,
    tokenExpireTime: 0,
    tableData: null,
    freshCacheTime: 0,
};

function sendRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        if (postData) req.write(postData);
        req.end();
    });
}

async function getTenantAccessToken() {
    const now = Date.now();
    if (cache.tenantAccessToken && cache.tokenExpireTime > now + 300000) {
        return cache.tenantAccessToken;
    }
    const options = {
        hostname: 'open.feishu.cn',
        port: 443,
        path: '/open-apis/auth/v3/tenant_access_token/internal',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
    };
    const response = await sendRequest(options, JSON.stringify({
        app_id: envVars.FEISHU_APP_ID,
        app_secret: envVars.FEISHU_APP_SECRET,
    }));
    if (response.code === 0) {
        cache.tenantAccessToken = response.tenant_access_token;
        cache.tokenExpireTime = now + response.expire * 1000;
        return response.tenant_access_token;
    }
    throw new Error(response.msg);
}

async function getTableFields(token) {
    const options = {
        hostname: 'open.feishu.cn',
        port: 443,
        path: `/open-apis/bitable/v1/apps/${envVars.FEISHU_APP_TOKEN}/tables/${envVars.FEISHU_TABLE_ID}/fields?view_id=${envVars.FEISHU_VIEW_ID}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
    };
    const response = await sendRequest(options);
    if (response.code === 0) return response.data.items;
    throw new Error(response.msg);
}

async function getTableRecords(token) {
    const options = {
        hostname: 'open.feishu.cn',
        port: 443,
        path: `/open-apis/bitable/v1/apps/${envVars.FEISHU_APP_TOKEN}/tables/${envVars.FEISHU_TABLE_ID}/records/search`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
        },
    };
    const response = await sendRequest(options, JSON.stringify({ view_id: envVars.FEISHU_VIEW_ID }));
    if (response.code === 0) return response.data.items;
    throw new Error(response.msg);
}

function formatFieldValue(value, fieldType) {
    if (value === null || value === undefined) return '-';
    if (Array.isArray(value)) {
        if (value[0] && value[0].text) return value[0].text;
        if (value[0] && value[0].name) return value[0].name;
        return JSON.stringify(value);
    }
    if (fieldType === 1001 && typeof value === 'number') {
        return new Date(value).toLocaleString('zh-CN');
    }
    return String(value);
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        const now = Date.now();
        if (cache.tableData && cache.freshCacheTime > now) {
            return res.status(200).json(cache.tableData);
        }
        
        const token = await getTenantAccessToken();
        const fields = await getTableFields(token);
        const records = await getTableRecords(token);
        
        const formattedData = {
            fields: fields.map(f => ({
                id: f.field_id,
                name: f.field_name,
                type: f.type,
            })),
            records: records.map(r => {
                const formattedRecord = { id: r.record_id, fields: {} };
                fields.forEach(f => {
                    formattedRecord.fields[f.field_name] = formatFieldValue(r.fields[f.field_name], f.type);
                });
                return formattedRecord;
            }),
            timestamp: new Date().toISOString(),
            total: records.length,
        };
        
        cache.tableData = formattedData;
        cache.freshCacheTime = now + 30000;
        
        res.status(200).json(formattedData);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
