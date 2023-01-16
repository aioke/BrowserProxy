using System.Collections.Concurrent;
using DateTime = System.DateTime;

namespace BrowserProxy;

public class PageLoader : IDisposable
{
    private readonly int queueSize = 10;
    private readonly TimeSpan maxWaitTime = TimeSpan.FromSeconds(30);
    private ConcurrentQueue<QueueItem> pendingQueue;
    private HashSet<QueueItem> queueItemsInProgress;
    private CancellationTokenSource mainLoopCancellationTokenSource;

    public PageLoader()
    {
        pendingQueue = new ConcurrentQueue<QueueItem>();
        queueItemsInProgress = new HashSet<QueueItem>();
        mainLoopCancellationTokenSource = new CancellationTokenSource();
        Task.Factory.StartNew(MainLoop, mainLoopCancellationTokenSource.Token);
    }

    public async Task<string> LoadUrlAsync(string url, string? waitSelector = null, string? clickSelector = null)
    {
        if (pendingQueue.Count >= queueSize)
        {
            throw new OverflowException("Too many requests");
        }

        if (string.IsNullOrEmpty(url))
        {
            throw new ArgumentException("Url can't be null");
        }

        var taskCompletionSource = new TaskCompletionSource<string>();
        var queueItem = new QueueItem()
        {
            Url = url,
            WaitSelector = waitSelector,
            ClickSelector = clickSelector,
            StartTime = DateTime.Now,
            TaskCompletionSource = taskCompletionSource
        };
        pendingQueue.Enqueue(queueItem);
        var result = await taskCompletionSource.Task;
        return result;
    }

    public UrlToLoad? GetUrlToLoad()
    {
        pendingQueue.TryDequeue(out var queueItem);
        if (queueItem == null)
        {
            return null;
        }

        queueItemsInProgress.Add(queueItem);
        var urlToLoad = new UrlToLoad
        {
            Url = queueItem.Url,
            WaitSelector = queueItem.WaitSelector,
            ClickSelector = queueItem.ClickSelector
        };
        return urlToLoad;
    }

    public void TrySetResult(string url, string result)
    {
        var itemsInProgressToSet = queueItemsInProgress
            .Where(i => i.Url == url)
            .ToList();
        foreach (var queueItem in itemsInProgressToSet)
        {
            TrySetResult(queueItem.TaskCompletionSource, result);
            queueItemsInProgress.Remove(queueItem);
        }
    }

    private void MainLoop(object cancelationToken)
    {
        var token = (CancellationToken)cancelationToken;
        while (!token.IsCancellationRequested)
        {
            HandleRequestTimeouts();
            Thread.Sleep(2000);
        }
    }

    private void HandleRequestTimeouts()
    {
        var discardRequestsStartedBefore = DateTime.Now.Add(-maxWaitTime);
        HandlePendingRequestsTimeouts(discardRequestsStartedBefore);
        HandleInProgressRequestsTimeouts(discardRequestsStartedBefore);
    }

    private void HandlePendingRequestsTimeouts(DateTime discardRequestsStartedBefore)
    {
        pendingQueue.TryPeek(out var queueItem);
        while (queueItem != null && queueItem.StartTime < discardRequestsStartedBefore)
        {
            TrySetTimeoutException(queueItem.TaskCompletionSource);
            pendingQueue.TryDequeue(out _);
            pendingQueue.TryPeek(out queueItem);
        }
    }

    private void HandleInProgressRequestsTimeouts(DateTime discardRequestsStartedBefore)
    {
        var itemsInProgressToDiscard = queueItemsInProgress
            .Where(i => i.StartTime < discardRequestsStartedBefore)
            .ToList();
        foreach (var item in itemsInProgressToDiscard)
        {
            TrySetTimeoutException(item.TaskCompletionSource);
            queueItemsInProgress.Remove(item);
        }
    }

    private void TrySetTimeoutException(TaskCompletionSource<string> taskCompletionSource)
    {
        var exception = new TimeoutException("Timeout expired");
        Task.Run(() => taskCompletionSource.TrySetException(exception));
    }

    private void TrySetResult(TaskCompletionSource<string> taskCompletionSource, string result)
    {
        Task.Run(() => taskCompletionSource.TrySetResult(result));
    }

    public void Dispose()
    {
        mainLoopCancellationTokenSource.Cancel();
    }

    private class QueueItem
    {
        public string Url { get; init; }
        public string? WaitSelector { get; init; }
        public string? ClickSelector { get; set; }
        public DateTime StartTime { get; init; }
        public TaskCompletionSource<string> TaskCompletionSource { get; init; }
    }
}