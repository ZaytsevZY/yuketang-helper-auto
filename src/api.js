export async function request(path, options = {}) {
  const url = new URL(path, location.origin);
  const init = {
    method: options.method ?? "GET",
    headers: options.headers,
    mode: "cors",
    credentials: "include",
  };

  if (options.bearer) {
    init.headers["Authorization"] = "Bearer " + localStorage.getItem("Authorization");
  }

  if (options.params) {
    for (const key in options.params) {
      url.searchParams.set(key, options.params[key]);
    }
  }

  if (options.body) {
    init.headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(options.body);
  }

  const resp = await fetch(url.href, init);
  if (options.bearer && resp.headers.has("Set-Auth")) {
    localStorage.setItem("Authorization", resp.headers.get("Set-Auth"));
  }

  const json = await resp.json();
  return json;
}

export const H5_HEADERS = {
  "xtbz": "ykt",
  "X-Client": "h5",
};

export const WEB_HEADERS = {
  "university-id": "0",
  "uv-id": "0",
  "X-Client": "web",
  "Xt-Agent": "web",
};

export function answerProblem(problem, result, dt = Date.now()) {
  return request("/api/v3/lesson/problem/answer", {
    method: "POST",
    headers: H5_HEADERS,
    body: {
      problemId: problem.problemId,
      problemType: problem.problemType,
      dt: dt,
      result: result
    },
    bearer: true,
  });
}

export function retryProblem(problem, result, dt) {
  return request("/api/v3/lesson/problem/retry", {
    method: "POST",
    headers: H5_HEADERS,
    body: {
      problems: [{
        problemId: problem.problemId,
        problemType: problem.problemType,
        dt: dt,
        result: result
      }]
    },
    bearer: true,
  });
}

export async function getActiveLessons() {
  return request("/api/v3/classroom/on-lesson-upcoming-exam", {
    method: "GET",
    headers: WEB_HEADERS,
  });
}

export async function getCourseList() {
  return request("/v2/api/web/courses/list?identity=2", {
    method: "GET",
    headers: WEB_HEADERS,
  });
}
