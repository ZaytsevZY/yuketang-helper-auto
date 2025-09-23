// src/tsm/answer.js
export function submitAnswer(problem, result) {
  const url = '/api/v3/lesson/problem/answer';
  const headers = {
    'Content-Type': 'application/json',
    'xtbz': 'ykt',
    'X-Client': 'h5',
    'Authorization': 'Bearer ' + localStorage.getItem('Authorization'),
  };
  const data = {
    problemId: problem.problemId,
    problemType: problem.problemType,
    dt: Date.now(),
    result,
  };

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => {
      try {
        const resp = JSON.parse(xhr.responseText);
        if (resp.code === 0) resolve(resp);
        else reject(new Error(`${resp.msg} (${resp.code})`));
      } catch { reject(new Error('解析响应失败')); }
    };
    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.send(JSON.stringify(data));
  });
}

export function retryAnswer(problem, result, dt) {
  const url = '/api/v3/lesson/problem/retry';
  const headers = {
    'Content-Type': 'application/json',
    'xtbz': 'ykt',
    'X-Client': 'h5',
    'Authorization': 'Bearer ' + localStorage.getItem('Authorization'),
  };
  const data = {
    problems: [{ problemId: problem.problemId, problemType: problem.problemType, dt, result }],
  };

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => {
      try {
        const resp = JSON.parse(xhr.responseText);
        if (resp.code === 0) {
          if (!resp.data?.success?.includes(problem.problemId)) reject(new Error('服务器未返回成功信息'));
          else resolve(resp);
        } else reject(new Error(`${resp.msg} (${resp.code})`));
      } catch { reject(new Error('解析响应失败')); }
    };
    xhr.onerror = () => reject(new Error('网络请求失败'));
    xhr.send(JSON.stringify(data));
  });
}
