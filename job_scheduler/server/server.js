const express = require('express');
var bodyParser = require('body-parser')
const Queue = require('bull');
const { createBullBoard } = require('@bull-board/api');
const { BullAdapter } = require('@bull-board/api/bullAdapter');
const { ExpressAdapter } = require('@bull-board/express');

const port = process.env.PORT || 9090;
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = process.env.REDIS_PORT || 6379;
const intervalInMilli = 1000; // 1000 milliseconds


// A queue for the jobs scheduled based on a routine without any external requests
const routineJobsQueue = new Queue('routine_jobs', { redis: { port: redisPort, host: redisHost, lockDuration: 30000 } });
routineJobsQueue.clean(0, 'failed').then(res => { });

routineJobsQueue.on('completed', function (job, result) {
  const jobData = job.data;
  console.log(`job ${jobData.jobId} completed with result: ${JSON.stringify(result)}`)
})




// ------------ enable bull-ui -----------
const serverAdapter = new ExpressAdapter();
createBullBoard({
  queues: [
    new BullAdapter(routineJobsQueue),
  ],
  serverAdapter: serverAdapter
});

const app = express();
// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

serverAdapter.setBasePath('/admin/queues'); // An arbitrary path to serve the dashboard
app.use('/admin/queues', serverAdapter.getRouter());

app.get('/next/queue/:qname/:token', async (req, res) => {
  const { qname } = req.params;
  const worker = new Queue(qname, { redis: { port: redisPort, host: redisHost } });
  const job = await worker.getNextJob(req.params.token);
  if (!job) {
    return res.sendStatus(400);
  }
  console.log(`started processing job: ${job.id}`);
  await worker.close();
  res.send(JSON.stringify(job));
});

app.post('/queue/:qname/job/:jobId/result', async (req, res) => {
  const { qname, jobId } = req.params;
  const { returnValue, token, result } = req.body;
  console.log(`received the result for queue: ${qname}: ${jobId} result: ${result}`);
  const worker = new Queue(qname, { redis: { port: redisPort, host: redisHost } });
  const job = await worker.getJob(jobId);
  if (!job) {
    return res.sendStatus(400)
  }
  if (result === 'completed') {
    await job.moveToCompleted(returnValue, token);
  } else {
    await job.moveToFailed(returnValue, token);
  }
  // Call AO-API with the results
  await worker.close();
  res.sendStatus(200);
});

app.post('/queue/:qname/job', async (req, res) => {
  const { qname } = req.params;
  const payload = req.body;
  console.log(`Adding new job to queue: ${qname}`);
  const worker = new Queue(qname, { redis: { port: redisPort, host: redisHost } });
  try {
    const job = await worker.add(payload);
    await worker.close();
    res.send({
      jobId: job.id
    });  
  } catch (error) {
    console.error(error.message);
    res.sendStatus(500)
  }
});


app.listen(port, () => {
  console.log(`Listening on port: ${port}`)
});

