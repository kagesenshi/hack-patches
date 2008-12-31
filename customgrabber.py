# file: /usr/lib/python2.5/site-packages/urlgrabber/customgrabber.py

import grabber, sys, os
import subprocess
import urllib2

def get_filesize(url):
    usock = urllib2.urlopen(url)
    size =  usock.info().get('Content-Length')
    if size is None:
        size = 0
    return float(size) 

class AxelGrabber(grabber.URLGrabber):
   def urlgrab(self, url, filename=None, **kwargs):
        """grab the file at  and make a local copy at 
        If filename is none, the basename of the url is used.
        urlgrab returns the filename of the local file, which may be 
        different from the passed-in filename if copy_local == 0.
        """

        opts = self.opts.derive(**kwargs)
        (url,parts) = opts.urlparser.parse(url, opts)
        (scheme, host, path, parm, query, frag) = parts
        fsize = get_filesize(url)
        if (fsize/1024) < 100:
           parts = 1
        elif (fsize/1024) < 500:
           parts = 2
        elif (fsize/1024/1024) < 1:
           parts = 3
        elif (fsize/1024/1024) < 5:
           parts = 4
        elif (fsize/1024/1024) < 10:
           parts = 6
        elif (fsize/1024/1024) < 15:
           parts = 8
        else:
           parts = 10

        if parts == 1:
           return grabber.URLGrabber.urlgrab(self, url, filename=None, **kwargs)

        def retryfunc(opts, url, filename, parts):
            if (fsize/1024) < 100:
               parts = 1
            elif (fsize/1024) < 500:
               parts = 2
            elif (fsize/1024/1024) < 1:
               parts = 3
            elif (fsize/1024/1024) < 5:
               parts = 4
            elif (fsize/1024/1024) < 10:
               parts = 6
            elif (fsize/1024/1024) < 15:
               parts = 8
            else:
               parts = 10
            if os.path.exists(filename):
               if not os.path.exists("%s.st" % filename):
                  os.unlink(filename)
            p = subprocess.Popen(['/usr/bin/axel','-n','%s' % parts,'-a','-o',filename,url],stdout=sys.stdout,stderr=sys.stderr)
            o = p.wait()
            if o:
               raise grabber.URLGrabError(-1)
            return filename
 
        return self._retry(opts, retryfunc, url, filename, parts)
