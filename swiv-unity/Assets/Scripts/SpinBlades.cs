using UnityEngine;

public class SpinBlades : MonoBehaviour
{
    [SerializeField] float rpm = 40f;

    void Start()
    {
        
    }

    void Update()
    {
        transform.localRotation = Quaternion.Euler(transform.localRotation.x, Time.time * 60 * rpm, transform.localRotation.y);
    }
}
